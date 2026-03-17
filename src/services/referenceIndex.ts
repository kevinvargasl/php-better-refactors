import * as vscode from 'vscode';
import { IndexEntry } from '../types';
import { parsePhpFile } from '../parsers/phpParser';
import { isPhpFile, normalizePath } from '../utils/pathUtils';
import { buildFqcn, getShortName } from '../utils/phpStringUtils';
import { formatError } from '../utils/errorUtils';

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

    constructor(excludePatterns: string[] = ['**/vendor/**', '**/node_modules/**']) {
        this.excludePatterns = excludePatterns;
    }

    /**
     * Build the full index by scanning all PHP files in the workspace.
     */
    async buildIndex(): Promise<void> {
        const excludePattern = `{${this.excludePatterns.join(',')}}`;
        const files = await vscode.workspace.findFiles('**/*.php', excludePattern);

        // Process in batches to avoid overwhelming the extension host
        const batchSize = 50;
        for (let i = 0; i < files.length; i += batchSize) {
            const batch = files.slice(i, i + batchSize);
            await Promise.all(batch.map(uri => this.indexFileDirect(uri)));
        }

        this.onDidUpdateEmitter.fire();
    }

    /**
     * Index a file by reading directly from disk (lighter than openTextDocument).
     * Used for initial batch indexing where documents aren't open in the editor.
     */
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

    /**
     * Index a single PHP file.
     */
    async indexFile(filePath: string): Promise<void> {
        if (!isPhpFile(filePath)) {
            return;
        }

        const normalizedPath = normalizePath(filePath);
        try {
            const document = await vscode.workspace.openTextDocument(filePath);
            const content = document.getText();
            this.indexFileContent(normalizedPath, content);
        } catch (error) {
            console.warn('PHP Better Refactors: Failed to index file:', filePath, formatError(error));
            this.removeFile(normalizedPath);
        }
    }

    /**
     * Index a file from its content directly.
     */
    indexFileContent(filePath: string, content: string): void {
        // Remove old entry if re-indexing
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
            this.fqcnToFile.set(declaredFqcn, filePath);
            const short = getShortName(declaredFqcn);
            let list = this.shortNameToFqcns.get(short);
            if (!list) {
                list = [];
                this.shortNameToFqcns.set(short, list);
            }
            list.push(declaredFqcn);
        }

        // Build reverse index
        const referencedFqcns = new Set<string>();
        for (const use of entry.useStatements) {
            referencedFqcns.add(use.fqcn);
        }
        for (const ref of entry.references) {
            referencedFqcns.add(ref.resolvedFqcn);
        }
        for (const fqcn of referencedFqcns) {
            let files = this.fqcnToReferencingFiles.get(fqcn);
            if (!files) {
                files = new Set();
                this.fqcnToReferencingFiles.set(fqcn, files);
            }
            files.add(filePath);
        }
    }

    /**
     * Remove a file from the index.
     */
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
        // Clean reverse index
        for (const use of existing.useStatements) {
            this.fqcnToReferencingFiles.get(use.fqcn)?.delete(normalized);
        }
        for (const ref of existing.references) {
            this.fqcnToReferencingFiles.get(ref.resolvedFqcn)?.delete(normalized);
        }
        this.entries.delete(normalized);
    }

    /**
     * Get the file path for a FQCN.
     */
    getFileForFqcn(fqcn: string): string | undefined {
        return this.fqcnToFile.get(fqcn);
    }

    /**
     * Find all FQCNs in the index that end with the given short class name.
     */
    findFqcnsByShortName(shortName: string): string[] {
        return this.shortNameToFqcns.get(shortName) ?? [];
    }

    /**
     * Find all files that reference a given FQCN.
     */
    findReferencingFiles(fqcn: string): IndexEntry[] {
        const filePaths = this.fqcnToReferencingFiles.get(fqcn);
        if (!filePaths) {
            return [];
        }
        const results: IndexEntry[] = [];
        for (const fp of filePaths) {
            const entry = this.entries.get(fp);
            if (entry) {
                results.push(entry);
            }
        }
        return results;
    }

    /**
     * Start watching for file changes.
     */
    startWatching(): void {
        const watcher = vscode.workspace.createFileSystemWatcher('**/*.php');

        // Pre-compute exclude segments once instead of per-event
        const excludeSegments: string[] = [];
        for (const p of this.excludePatterns) {
            const segment = p.replace(/\*\*/g, '').replace(/\*/g, '').replace(/\\/g, '/');
            if (segment.length > 0) {
                excludeSegments.push(segment);
            }
        }

        const shouldExclude = (uri: vscode.Uri): boolean => {
            const rel = normalizePath(vscode.workspace.asRelativePath(uri, false));
            return excludeSegments.some(seg => rel.includes(seg));
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
