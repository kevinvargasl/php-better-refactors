import * as vscode from 'vscode';
import * as path from 'path';
import { parsePhpFile } from '../parsers/phpParser';
import { ReferenceUpdater } from '../services/referenceUpdater';
import { Psr4Resolver } from '../services/psr4Resolver';
import { isPhpFile, getBaseName } from '../utils/pathUtils';
import { buildFqcn, getNamespacePart } from '../utils/phpStringUtils';
import { mergeWorkspaceEdit, mergeEdits } from '../utils/workspaceEditUtils';
import { formatError } from '../utils/errorUtils';
import { FileOperationGuard } from '../services/fileOperationGuard';

/**
 * Handles both file renames (same directory) and file moves (different directory)
 * via a single onWillRenameFiles listener.
 */
export class FileRenameHandler {
    constructor(
        private updater: ReferenceUpdater,
        private resolver: Psr4Resolver | null,
        private options: { rename: boolean; move: boolean },
        private operationGuard: FileOperationGuard,
    ) {}

    register(): vscode.Disposable {
        return vscode.workspace.onWillRenameFiles(event => {
            const edit = this.handle(event);
            if (edit) {
                event.waitUntil(edit);
            }
        });
    }

    private handle(event: vscode.FileRenameEvent): Promise<vscode.WorkspaceEdit> | undefined {
        const edits: Promise<vscode.WorkspaceEdit>[] = [];

        for (const { oldUri, newUri } of event.files) {
            if (!isPhpFile(oldUri.fsPath) || !isPhpFile(newUri.fsPath)) {
                continue;
            }
            if (this.operationGuard.consumeRename(oldUri.fsPath, newUri.fsPath)) {
                continue;
            }

            const sameDir = path.dirname(oldUri.fsPath) === path.dirname(newUri.fsPath);
            const oldName = getBaseName(oldUri.fsPath);
            const newName = getBaseName(newUri.fsPath);
            const nameChanged = oldName !== newName;

            if (sameDir && nameChanged && this.options.rename) {
                edits.push(this.processRename(oldUri, oldName, newName));
            } else if (!sameDir && this.options.move) {
                edits.push(this.processMove(oldUri, newUri));
            }
        }

        if (edits.length === 0) {
            return undefined;
        }

        return mergeEdits(edits);
    }

    private async processRename(oldUri: vscode.Uri, oldName: string, newName: string): Promise<vscode.WorkspaceEdit> {
        const combinedEdit = new vscode.WorkspaceEdit();

        try {
            const document = await vscode.workspace.openTextDocument(oldUri);
            const info = parsePhpFile(document.getText());

            if (!info.className || !info.classLoc || info.className !== oldName) {
                return combinedEdit;
            }

            const oldFqcn = buildFqcn(info.namespace, oldName);
            const newFqcn = buildFqcn(info.namespace, newName);

            mergeWorkspaceEdit(combinedEdit,
                this.updater.buildClassRenameEdit(oldUri.fsPath, info.classLoc, oldName, newName));
            mergeWorkspaceEdit(combinedEdit,
                await this.updater.buildEditsForRename(oldFqcn, newFqcn));
        } catch (error) {
            console.warn('PHP Better Refactors: Error processing file rename:', formatError(error));
        }

        return combinedEdit;
    }

    private async processMove(oldUri: vscode.Uri, newUri: vscode.Uri): Promise<vscode.WorkspaceEdit> {
        const combinedEdit = new vscode.WorkspaceEdit();

        if (!this.resolver) {
            return combinedEdit;
        }

        try {
            const document = await vscode.workspace.openTextDocument(oldUri);
            const info = parsePhpFile(document.getText());
            if (!info.className) {
                return combinedEdit;
            }

            const oldName = getBaseName(oldUri.fsPath);
            const newName = getBaseName(newUri.fsPath);
            const nameChanged = oldName !== newName;

            const className = info.className;
            const shouldRenameClass = nameChanged && info.className === oldName && info.classLoc !== null;
            const newClassName = shouldRenameClass ? newName : className;
            const oldFqcn = buildFqcn(info.namespace, className);

            // Resolve new namespace from PSR-4
            const newResolution = this.resolver.resolveNamespace(newUri.fsPath);
            const newNamespace = newResolution
                ? getNamespacePart(newResolution.fqcn)
                : info.namespace;
            const newFqcn = buildFqcn(newNamespace, newClassName);

            // Update namespace declaration
            if (newResolution && newNamespace !== info.namespace) {
                mergeWorkspaceEdit(combinedEdit,
                    this.updater.buildNamespaceEditFromInfo(
                        oldUri.fsPath, info.namespaceLoc, info.preambleInsertPosition,
                        info.namespace, newNamespace || ''));
            } else if (!newResolution && info.namespace) {
                vscode.window.showWarningMessage(
                    `PHP Better Refactors: File moved outside PSR-4 mapping. Namespace was not updated.`);
            }

            // If also renamed, update class declaration
            if (shouldRenameClass && info.classLoc) {
                mergeWorkspaceEdit(combinedEdit,
                    this.updater.buildClassRenameEdit(oldUri.fsPath, info.classLoc, oldName, newName));
            }

            // Update references
            if (oldFqcn !== newFqcn) {
                mergeWorkspaceEdit(combinedEdit,
                    await this.updater.buildEditsForRename(oldFqcn, newFqcn));
            }
        } catch (error) {
            console.warn('PHP Better Refactors: Error processing file move:', formatError(error));
        }

        return combinedEdit;
    }
}
