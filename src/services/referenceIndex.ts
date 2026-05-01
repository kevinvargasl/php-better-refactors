import * as vscode from 'vscode';
import { IndexEntry } from '../types';
import { parsePhpFile } from '../parsers/phpParser';
import { isPhpFile, normalizePath } from '../utils/pathUtils';
import { buildExcludeSegments, matchesExcludeSegments } from '../utils/excludeUtils';
import { buildFqcn, getShortName } from '../utils/phpStringUtils';
import { formatError } from '../utils/errorUtils';
import { readTextFilePreferOpenDocument } from '../utils/documentUtils';

/**
 * Workspace-wide index of all PHP class declarations and references.
 * Built on activation, updated incrementally via file watchers.
 */
export class ReferenceIndex {
    private entries: Map<string, IndexEntry> = new Map();
    private fqcnToFile: Map<string, string> = new Map();
    /** Reverse index: FQCN → set of file paths that reference it */
    private fqcnToReferencingFiles: Map<string, Set<string>> = new Map();
    /** Short class name → list of FQCNs for O(1) import suggestions */
    private shortNameToFqcns: Map<string, string[]> = new Map();
    private disposables: vscode.Disposable[] = [];
    private excludePatterns: string[];
    private changeTimers: Map<string, NodeJS.Timeout> = new Map();
    private onDidUpdateEmitter = new vscode.EventEmitter<void>();
    public readonly onDidUpdate = this.onDidUpdateEmitter.event;

    constructor(excludePatterns: string[] = ['**/vendor/**', '**/node_modules/**', '**/storage/**', '**/.phpunit.cache/**', '**/.phpstan/**', '**/.php-cs-fixer.cache/**']) {
        this.excludePatterns = excludePatterns;
    }

    async buildIndex(): Promise<void> {
        this.entries.clear();
        this.fqcnToFile.clear();
        this.fqcnToReferencingFiles.clear();
        this.shortNameToFqcns.clear();

        const excludePattern = `{${this.excludePatterns.join(',')}}`;
        const files = await vscode.workspace.findFiles('**/*.php', excludePattern);

        const batchSize = 50;
        for (let i = 0; i < files.length; i += batchSize) {
            const batch = files.slice(i, i + batchSize);
            await Promise.all(batch.map(uri => this.indexFileDirect(uri)));
        }

        await this.indexVendorDeclarations();

        this.onDidUpdateEmitter.fire();
    }

    private async indexFileDirect(uri: vscode.Uri): Promise<void> {
        if (!isPhpFile(uri.fsPath)) {
            return;
        }
        const normalizedPath = normalizePath(uri.fsPath);
        try {
            const raw = await vscode.workspace.fs.readFile(uri);
            const content = Buffer.from(raw).toString('utf8');
            this.indexFileContent(normalizedPath, content);
        } catch (error) {
            console.warn('PHP Better Refactors: Failed to index file:', uri.fsPath, formatError(error));
            this.removeFile(normalizedPath);
        }
    }

    async indexFile(filePath: string): Promise<void> {
        if (!isPhpFile(filePath)) {
            return;
        }

        const normalizedPath = normalizePath(filePath);
        try {
            const content = await readTextFilePreferOpenDocument(filePath);
            this.indexFileContent(normalizedPath, content);
        } catch (error) {
            console.warn('PHP Better Refactors: Failed to index file:', filePath, formatError(error));
            this.removeFile(normalizedPath);
        }
    }

    indexFileContent(filePath: string, content: string): void {
        if (this.entries.has(filePath)) {
            this.removeFile(filePath);
        }

        const info = parsePhpFile(content);
        const declaredFqcn = info.className
            ? buildFqcn(info.namespace, info.className)
            : null;

        const entry: IndexEntry = {
            filePath,
            namespace: info.namespace,
            declaredFqcn,
            useStatements: info.useStatements,
            references: info.references,
        };

        this.entries.set(filePath, entry);
        if (declaredFqcn) {
            this.registerFqcn(declaredFqcn, filePath);
        }

        const referencedFqcns = new Set([
            ...entry.useStatements.map(use => use.fqcn),
            ...entry.references.map(ref => ref.resolvedFqcn),
        ]);
        for (const fqcn of referencedFqcns) {
            let files = this.fqcnToReferencingFiles.get(fqcn);
            if (!files) {
                files = new Set();
                this.fqcnToReferencingFiles.set(fqcn, files);
            }
            files.add(filePath);
        }
    }

    removeFile(filePath: string): void {
        const normalized = normalizePath(filePath);
        const existing = this.entries.get(normalized);
        if (!existing) {
            return;
        }
        if (existing.declaredFqcn) {
            this.fqcnToFile.delete(existing.declaredFqcn);
            const short = getShortName(existing.declaredFqcn);
            const list = this.shortNameToFqcns.get(short);
            if (list) {
                const idx = list.indexOf(existing.declaredFqcn);
                if (idx !== -1) { list.splice(idx, 1); }
                if (list.length === 0) { this.shortNameToFqcns.delete(short); }
            }
        }
        for (const use of existing.useStatements) {
            this.removeReferencingFile(use.fqcn, normalized);
        }
        for (const ref of existing.references) {
            this.removeReferencingFile(ref.resolvedFqcn, normalized);
        }
        this.entries.delete(normalized);
    }

    getFileForFqcn(fqcn: string): string | undefined {
        return this.fqcnToFile.get(fqcn);
    }

    findFqcnsByShortName(shortName: string): string[] {
        return this.shortNameToFqcns.get(shortName) ?? [];
    }

    private registerFqcn(fqcn: string, filePath: string): void {
        this.fqcnToFile.set(fqcn, filePath);
        const short = getShortName(fqcn);
        let list = this.shortNameToFqcns.get(short);
        if (!list) {
            list = [];
            this.shortNameToFqcns.set(short, list);
        }
        list.push(fqcn);
    }

    findReferencingFiles(fqcn: string): IndexEntry[] {
        const filePaths = this.fqcnToReferencingFiles.get(fqcn);
        if (!filePaths) {
            return [];
        }
        return [...filePaths].map(filePath => this.entries.get(filePath)).filter((entry): entry is IndexEntry => entry !== undefined);
    }

    private removeReferencingFile(fqcn: string, filePath: string): void {
        const files = this.fqcnToReferencingFiles.get(fqcn);
        if (!files) {
            return;
        }

        files.delete(filePath);
        if (files.size === 0) {
            this.fqcnToReferencingFiles.delete(fqcn);
        }
    }

    /**
     * Scan vendor PHP files for class declarations using fast regex extraction.
     */
    private async indexVendorDeclarations(): Promise<void> {
        const vendorFiles = await vscode.workspace.findFiles(
            '**/vendor/**/*.php',
            '**/vendor/composer/**'
        );
        if (vendorFiles.length === 0) {
            return;
        }

        const batchSize = 100;
        for (let i = 0; i < vendorFiles.length; i += batchSize) {
            const batch = vendorFiles.slice(i, i + batchSize);
            await Promise.all(batch.map(async (uri) => {
                try {
                    const raw = await vscode.workspace.fs.readFile(uri);
                    const content = Buffer.from(raw).toString('utf8');
                    const decl = extractClassDeclarationFast(content);
                    if (decl.className) {
                        const fqcn = buildFqcn(decl.namespace, decl.className);
                        if (!this.fqcnToFile.has(fqcn)) {
                            this.registerFqcn(fqcn, normalizePath(uri.fsPath));
                        }
                    }
                } catch { /* skip unreadable files */ }
            }));
        }
    }

    startWatching(): void {
        const watcher = vscode.workspace.createFileSystemWatcher('**/*.php');

        const excludeSegments = buildExcludeSegments(this.excludePatterns);
        const shouldExclude = (uri: vscode.Uri): boolean => {
            const rel = normalizePath(vscode.workspace.asRelativePath(uri, false));
            return matchesExcludeSegments(rel, excludeSegments);
        };

        watcher.onDidCreate(uri => {
            if (!shouldExclude(uri)) {
                this.indexFile(uri.fsPath).then(() => this.onDidUpdateEmitter.fire());
            }
        });
        watcher.onDidChange(uri => {
            if (shouldExclude(uri)) { return; }
            const key = normalizePath(uri.fsPath);
            const existing = this.changeTimers.get(key);
            if (existing) { clearTimeout(existing); }
            this.changeTimers.set(key, setTimeout(() => {
                this.changeTimers.delete(key);
                this.indexFile(uri.fsPath).then(() => this.onDidUpdateEmitter.fire());
            }, 300));
        });
        watcher.onDidDelete(uri => {
            if (!shouldExclude(uri)) {
                const delKey = normalizePath(uri.fsPath);
                const pending = this.changeTimers.get(delKey);
                if (pending) {
                    clearTimeout(pending);
                    this.changeTimers.delete(delKey);
                }
                this.removeFile(uri.fsPath);
                this.onDidUpdateEmitter.fire();
            }
        });

        this.disposables.push(watcher);
    }

    dispose(): void {
        this.changeTimers.forEach(t => clearTimeout(t));
        this.changeTimers.clear();
        this.disposables.forEach(d => d.dispose());
        this.onDidUpdateEmitter.dispose();
    }
}

const NS_REGEX = /^\s*namespace\s+([\w\\]+)\s*[;{]/m;
const CLASS_REGEX = /^\s*(?:(?:abstract|final|readonly)\s+)*(?:class|interface|trait|enum)\s+([A-Z_]\w*)/m;

function extractClassDeclarationFast(content: string): { namespace: string | null; className: string | null } {
    const nsMatch = NS_REGEX.exec(content);
    const classMatch = CLASS_REGEX.exec(content);
    return {
        namespace: nsMatch ? nsMatch[1] : null,
        className: classMatch ? classMatch[1] : null,
    };
}

