import * as vscode from 'vscode';

/**
 * Merge all edits from source into target WorkspaceEdit.
 */
export function mergeWorkspaceEdit(target: vscode.WorkspaceEdit, source: vscode.WorkspaceEdit): void {
    for (const [uri, textEdits] of source.entries()) {
        for (const textEdit of textEdits) {
            if (textEdit instanceof vscode.TextEdit) {
                target.replace(uri, textEdit.range, textEdit.newText);
            }
        }
    }
}

/**
 * Resolve multiple WorkspaceEdit promises and merge them into one.
 */
export async function mergeEdits(edits: Promise<vscode.WorkspaceEdit>[]): Promise<vscode.WorkspaceEdit> {
    const combined = new vscode.WorkspaceEdit();
    const resolved = await Promise.all(edits);
    for (const edit of resolved) {
        mergeWorkspaceEdit(combined, edit);
    }
    return combined;
}
