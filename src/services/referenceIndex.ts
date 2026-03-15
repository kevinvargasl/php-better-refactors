import * as vscode from 'vscode';
import { IndexEntry } from '../types';
import { parsePhpFile } from '../parsers/phpParser';
import { isPhpFile, normalizePath } from '../utils/pathUtils';
import { buildFqcn } from '../utils/phpStringUtils';

/**
 * Workspace-wide index of all PHP class declarations and references.
 * Built on activation, updated incrementally via file watchers.
 */
export class ReferenceIndex {
    private entries: Map<string, IndexEntry> = new Map();
    private fqcnToFile: Map<string, string> = new Map();
    /** Reverse index: FQCN → set of file paths that reference it */
    private fqcnToReferencingFiles: Map<string, Set<string>> = new Map();
    private disposables: vscode.Disposable[] = [];
    private excludePatterns: string[];
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
            await Promise.all(batch.map(uri => this.indexFile(uri.fsPath)));
        }

        this.onDidUpdateEmitter.fire();
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
        } catch {
            // File may have been deleted or be unreadable
            this.removeFile(normalizedPath);
        }
    }

    /**
     * Index a file from its content directly.
     */
    indexFileContent(filePath: string, content: string): void {
        filePath = normalizePath(filePath);
        // Remove old entry first
        this.removeFile(filePath);

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
     * Get the index entry for a file.
     */
    getEntry(filePath: string): IndexEntry | undefined {
        return this.entries.get(normalizePath(filePath));
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
        const suffix = '\\' + shortName;
        const results: string[] = [];
        for (const fqcn of this.fqcnToFile.keys()) {
            if (fqcn === shortName || fqcn.endsWith(suffix)) {
                results.push(fqcn);
            }
        }
        return results;
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

        // Pre-extract path segments to match (e.g. "**/vendor/**" → "/vendor/")
        const excludeSegments = this.excludePatterns
            .map(p => p.replace(/\*\*/g, '').replace(/\*/g, ''))
            .filter(s => s.length > 0);

        const shouldExclude = (fsPath: string): boolean => {
            const normalized = fsPath.replace(/\\/g, '/');
            return excludeSegments.some(segment => normalized.includes(segment));
        };

        watcher.onDidCreate(uri => {
            if (!shouldExclude(uri.fsPath)) {
                this.indexFile(uri.fsPath).then(() => this.onDidUpdateEmitter.fire());
            }
        });
        watcher.onDidChange(uri => {
            if (!shouldExclude(uri.fsPath)) {
                this.indexFile(uri.fsPath).then(() => this.onDidUpdateEmitter.fire());
            }
        });
        watcher.onDidDelete(uri => {
            if (!shouldExclude(uri.fsPath)) {
                this.removeFile(uri.fsPath);
                this.onDidUpdateEmitter.fire();
            }
        });

        this.disposables.push(watcher);
    }

    /**
     * Update the FQCN mapping when a class is renamed.
     * Call this after updating the index entry.
     */
    updateFqcnMapping(oldFqcn: string, newFqcn: string, filePath: string): void {
        this.fqcnToFile.delete(oldFqcn);
        this.fqcnToFile.set(newFqcn, normalizePath(filePath));
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.onDidUpdateEmitter.dispose();
    }
}
