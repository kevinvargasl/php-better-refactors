import * as vscode from 'vscode';
import * as path from 'path';
import { parsePhpFile } from '../parsers/phpParser';
import { ReferenceIndex } from '../services/referenceIndex';
import { ReferenceUpdater } from '../services/referenceUpdater';
import { ClassRenameDetector } from '../services/classRenameDetector';
import { buildFqcn } from '../utils/phpStringUtils';

/**
 * Handles class rename detection: when a class name is changed in the editor,
 * offers to rename the file and update references.
 */
export class ClassRenameHandler {
    private inProgress = new Set<string>();
    private disposables: vscode.Disposable[] = [];

    constructor(
        private index: ReferenceIndex,
        private updater: ReferenceUpdater,
        private detector: ClassRenameDetector
    ) {}

    /**
     * Register the handler.
     */
    register(): vscode.Disposable[] {
        // Listen for class rename detections
        const detectionDisposable = this.detector.onClassRenamed(async event => {
            if (this.inProgress.has(event.filePath)) {
                return;
            }
            await this.handleClassRenamed(event.filePath, event.oldClassName, event.newClassName);
        });

        // Register the command for the code action
        const commandDisposable = vscode.commands.registerCommand(
            'phpBetterRefactors.renameFileToMatchClass',
            async (uri: vscode.Uri, newClassName: string) => {
                await this.renameFileToMatchClass(uri, newClassName);
            }
        );

        // Register code action provider
        const codeActionDisposable = vscode.languages.registerCodeActionsProvider(
            { language: 'php', scheme: 'file' },
            this.detector.createCodeActionProvider(),
            { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
        );

        this.disposables.push(detectionDisposable, commandDisposable, codeActionDisposable);
        return this.disposables;
    }

    private async handleClassRenamed(
        filePath: string,
        oldClassName: string,
        newClassName: string
    ): Promise<void> {
        const response = await vscode.window.showInformationMessage(
            `Class renamed from "${oldClassName}" to "${newClassName}". Rename file and update references?`,
            'Yes',
            'No'
        );

        if (response !== 'Yes') {
            return;
        }

        this.inProgress.add(filePath);
        try {
            await this.performClassRename(filePath, oldClassName, newClassName);
        } finally {
            this.inProgress.delete(filePath);
        }
    }

    private async performClassRename(
        filePath: string,
        oldClassName: string,
        newClassName: string
    ): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument(filePath);
            const info = parsePhpFile(document.getText());

            const oldFqcn = buildFqcn(info.namespace, oldClassName);
            const newFqcn = buildFqcn(info.namespace, newClassName);

            // Update all references across the project
            const refEdit = await this.updater.buildEditsForRename(oldFqcn, newFqcn);
            await vscode.workspace.applyEdit(refEdit);

            // Rename the file
            const dir = path.dirname(filePath);
            const newFilePath = path.join(dir, newClassName + '.php');
            const oldUri = vscode.Uri.file(filePath);
            const newUri = vscode.Uri.file(newFilePath);

            const renameEdit = new vscode.WorkspaceEdit();
            renameEdit.renameFile(oldUri, newUri);
            await vscode.workspace.applyEdit(renameEdit);

            // Update tracking
            this.detector.updateTracking(filePath, newFilePath, newClassName);

            // Re-index the file at new path
            await this.index.indexFile(newFilePath);
        } catch (error) {
            console.error('PHP Better Refactors: Error performing class rename', error);
            vscode.window.showErrorMessage(
                `PHP Better Refactors: Failed to rename file. ${error}`
            );
        }
    }

    private async renameFileToMatchClass(uri: vscode.Uri, newClassName: string): Promise<void> {
        const filePath = uri.fsPath;
        const oldClassName = path.basename(filePath, '.php');

        if (oldClassName === newClassName) {
            return;
        }

        this.inProgress.add(filePath);
        try {
            await this.performClassRename(filePath, oldClassName, newClassName);
        } finally {
            this.inProgress.delete(filePath);
        }
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }
}
