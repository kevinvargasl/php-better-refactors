import * as vscode from 'vscode';
import { parsePhpFile } from '../parsers/phpParser';
import { getBaseName, isPhpFile } from '../utils/pathUtils';

/**
 * Detects when a class name is changed in the editor and doesn't match the filename.
 * Triggers on file save rather than on every keystroke.
 */
export class ClassRenameDetector {
    private lastKnownClassNames: Map<string, string> = new Map();
    private disposables: vscode.Disposable[] = [];
    private onClassRenamedEmitter = new vscode.EventEmitter<{
        filePath: string;
        oldClassName: string;
        newClassName: string;
    }>();
    public readonly onClassRenamed = this.onClassRenamedEmitter.event;

    startWatching(): void {
        // Track currently open documents
        for (const doc of vscode.workspace.textDocuments) {
            if (isPhpFile(doc.fileName)) {
                this.trackDocument(doc);
            }
        }

        // Check for class rename on save
        const saveDisposable = vscode.workspace.onDidSaveTextDocument(doc => {
            if (isPhpFile(doc.fileName)) {
                this.checkForClassRename(doc);
            }
        });

        // Track newly opened documents
        const openDisposable = vscode.workspace.onDidOpenTextDocument(doc => {
            if (isPhpFile(doc.fileName)) {
                this.trackDocument(doc);
            }
        });

        // Clean up on close
        const closeDisposable = vscode.workspace.onDidCloseTextDocument(doc => {
            this.lastKnownClassNames.delete(doc.fileName);
        });

        this.disposables.push(saveDisposable, openDisposable, closeDisposable);
    }

    private trackDocument(document: vscode.TextDocument): void {
        try {
            const info = parsePhpFile(document.getText());
            if (info.className) {
                this.lastKnownClassNames.set(document.fileName, info.className);
            }
        } catch {
            // Parse errors are expected
        }
    }

    private checkForClassRename(document: vscode.TextDocument): void {
        try {
            const info = parsePhpFile(document.getText());
            if (!info.className) {
                return;
            }

            const lastKnown = this.lastKnownClassNames.get(document.fileName);
            const expectedName = getBaseName(document.fileName);

            if (lastKnown && info.className !== lastKnown && lastKnown === expectedName) {
                this.onClassRenamedEmitter.fire({
                    filePath: document.fileName,
                    oldClassName: lastKnown,
                    newClassName: info.className,
                });
            }

            this.lastKnownClassNames.set(document.fileName, info.className);
        } catch {
            // Parse errors are expected
        }
    }

    updateTracking(oldPath: string, newPath: string, className: string): void {
        this.lastKnownClassNames.delete(oldPath);
        this.lastKnownClassNames.set(newPath, className);
    }

    createCodeActionProvider(): vscode.CodeActionProvider {
        return new ClassNameMismatchCodeAction();
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.onClassRenamedEmitter.dispose();
    }
}

class ClassNameMismatchCodeAction implements vscode.CodeActionProvider {
    static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
    ): vscode.CodeAction[] | undefined {
        if (!isPhpFile(document.fileName)) {
            return;
        }

        try {
            const info = parsePhpFile(document.getText());
            if (!info.className || !info.classLoc) {
                return;
            }

            const expectedName = getBaseName(document.fileName);
            if (info.className === expectedName) {
                return;
            }

            // Only show if cursor is on the class name line
            if (range.start.line !== info.classLoc.startLine - 1) {
                return;
            }

            const action = new vscode.CodeAction(
                `Rename file to ${info.className}.php`,
                vscode.CodeActionKind.QuickFix
            );
            action.command = {
                command: 'phpBetterRefactors.renameFileToMatchClass',
                title: 'Rename file to match class',
                arguments: [document.uri, info.className],
            };

            return [action];
        } catch {
            return;
        }
    }
}
