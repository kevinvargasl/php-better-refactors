import * as vscode from 'vscode';
import { normalizePath } from './pathUtils';

export function findOpenFileDocument(filePath: string): vscode.TextDocument | undefined {
    const normalizedPath = normalizePath(filePath);
    return vscode.workspace.textDocuments.find(document =>
        document.uri.scheme === 'file' && normalizePath(document.uri.fsPath) === normalizedPath
    );
}

/**
 * Read the latest text for a workspace file.
 * Prefers an already-open editor buffer to preserve unsaved changes,
 * otherwise falls back to a direct filesystem read to avoid document-model overhead.
 */
export async function readTextFilePreferOpenDocument(filePath: string): Promise<string> {
    const openDocument = findOpenFileDocument(filePath);
    if (openDocument) {
        return openDocument.getText();
    }

    const raw = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
    return Buffer.from(raw).toString('utf8');
}
