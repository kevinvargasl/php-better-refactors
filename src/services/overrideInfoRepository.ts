import * as vscode from 'vscode';
import { ReferenceIndex } from './referenceIndex';
import { PhpFileInfo } from '../types';
import { findOpenFileDocument, readTextFilePreferOpenDocument } from '../utils/documentUtils';
import { normalizePath } from '../utils/pathUtils';
import { parsePhpFile } from '../parsers/phpParser';

export interface LoadedPhpInfo {
    fqcn: string;
    filePath: string;
    info: PhpFileInfo;
}

interface CachedLoadedPhpInfo extends LoadedPhpInfo {
    documentVersion: number | null;
}

export class OverrideInfoRepository implements vscode.Disposable {
    private readonly cache = new Map<string, CachedLoadedPhpInfo>();
    private readonly disposables: vscode.Disposable[];

    constructor(private readonly referenceIndex: ReferenceIndex) {
        this.disposables = [
            vscode.workspace.onDidChangeTextDocument(event => {
                if (event.document.languageId === 'php' && event.document.uri.scheme === 'file') {
                    this.invalidateFile(event.document.uri.fsPath);
                }
            }),
            vscode.workspace.onDidOpenTextDocument(document => {
                if (document.languageId === 'php' && document.uri.scheme === 'file') {
                    this.invalidateFile(document.uri.fsPath);
                }
            }),
            vscode.workspace.onDidSaveTextDocument(document => {
                if (document.languageId === 'php' && document.uri.scheme === 'file') {
                    this.invalidateFile(document.uri.fsPath);
                }
            }),
            this.referenceIndex.onDidUpdate(() => this.cache.clear()),
        ];
    }

    dispose(): void {
        this.cache.clear();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }

    async loadForFqcn(fqcn: string): Promise<LoadedPhpInfo | null> {
        const filePath = this.referenceIndex.getFileForFqcn(fqcn);
        if (!filePath) {
            return null;
        }

        const normalizedPath = normalizePath(filePath);
        const openDocument = findOpenFileDocument(normalizedPath);
        const cached = this.cache.get(normalizedPath);
        const currentVersion = openDocument?.version ?? null;

        if (cached && cached.documentVersion === currentVersion) {
            return cached;
        }

        try {
            const content = openDocument
                ? openDocument.getText()
                : await readTextFilePreferOpenDocument(normalizedPath);
            const loaded: CachedLoadedPhpInfo = {
                fqcn,
                filePath: normalizedPath,
                info: parsePhpFile(content),
                documentVersion: currentVersion,
            };
            this.cache.set(normalizedPath, loaded);
            return loaded;
        } catch {
            this.cache.delete(normalizedPath);
            return null;
        }
    }

    private invalidateFile(filePath: string): void {
        this.cache.delete(normalizePath(filePath));
    }
}
