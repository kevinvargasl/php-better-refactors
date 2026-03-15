import * as vscode from 'vscode';
import * as path from 'path';
import { getCachedParse } from '../utils/parseCache';
import { ReferenceIndex } from '../services/referenceIndex';
import { ReferenceUpdater } from '../services/referenceUpdater';
import { isPhpFile } from '../utils/pathUtils';
import { buildFqcn, isValidClassName } from '../utils/phpStringUtils';
import { findMemberReferences } from '../utils/memberSearch';
import { locToRange, mergeWorkspaceEdit } from '../utils/workspaceEditUtils';
import { MemberDeclaration, PhpFileInfo } from '../types';

/**
 * Provides "Rename Symbol" (F2 / right-click → Rename) for PHP class names,
 * methods, and properties. Updates all references across the project.
 */
export class PhpClassRenameProvider implements vscode.RenameProvider {
    constructor(
        private index: ReferenceIndex,
        private updater: ReferenceUpdater,
    ) {}

    prepareRename(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): vscode.ProviderResult<vscode.Range | { range: vscode.Range; placeholder: string }> {
        if (!isPhpFile(document.fileName)) {
            return undefined;
        }

        const info = getCachedParse(document);

        // Check class name
        if (info.className && info.classLoc) {
            const classRange = locToRange(info.classLoc);
            if (classRange.contains(position)) {
                return { range: classRange, placeholder: info.className };
            }
        }

        // Check members (methods and properties)
        const member = this.findMemberAtPosition(info.members, position);
        if (member) {
            const nameRange = this.memberNameRange(member);
            if (nameRange.contains(position)) {
                return { range: nameRange, placeholder: member.name };
            }
        }

        return undefined;
    }

    async provideRenameEdits(
        document: vscode.TextDocument,
        position: vscode.Position,
        newName: string,
    ): Promise<vscode.WorkspaceEdit | undefined> {
        if (!isPhpFile(document.fileName)) {
            return undefined;
        }

        const info = getCachedParse(document);

        // Check class name first
        if (info.className && info.classLoc) {
            const classRange = locToRange(info.classLoc);
            if (classRange.contains(position)) {
                return this.renameClass(document, info, newName);
            }
        }

        // Check members
        const member = this.findMemberAtPosition(info.members, position);
        if (member) {
            const nameRange = this.memberNameRange(member);
            if (nameRange.contains(position)) {
                return this.renameMember(document, info, member, newName);
            }
        }

        return undefined;
    }

    /** Get the range covering just the member name (skipping $ for properties). */
    private memberNameRange(member: MemberDeclaration): vscode.Range {
        if (member.kind === 'property') {
            return new vscode.Range(
                member.loc.startLine - 1, member.loc.startColumn + 1,
                member.loc.endLine - 1, member.loc.endColumn
            );
        }
        return locToRange(member.loc);
    }

    private findMemberAtPosition(
        members: MemberDeclaration[],
        position: vscode.Position,
    ): MemberDeclaration | undefined {
        for (const member of members) {
            const startLine = member.loc.startLine - 1;
            const endLine = member.loc.endLine - 1;
            const startCol = member.kind === 'property'
                ? member.loc.startColumn + 1 // skip $
                : member.loc.startColumn;
            const endCol = member.loc.endColumn;

            if (position.line >= startLine && position.line <= endLine
                && position.character >= startCol && position.character <= endCol) {
                return member;
            }
        }
        return undefined;
    }

    // --- Class rename ---

    private async renameClass(
        document: vscode.TextDocument,
        info: PhpFileInfo,
        newName: string,
    ): Promise<vscode.WorkspaceEdit | undefined> {
        if (!isValidClassName(newName)) {
            throw new Error(`"${newName}" is not a valid PHP class name.`);
        }
        if (!info.className || !info.classLoc) {
            return undefined;
        }

        const oldClassName = info.className;
        if (oldClassName === newName) {
            return undefined;
        }

        const oldFqcn = buildFqcn(info.namespace, oldClassName);
        const newFqcn = buildFqcn(info.namespace, newName);

        const edit = new vscode.WorkspaceEdit();
        const uri = document.uri;

        edit.replace(uri, locToRange(info.classLoc), newName);

        mergeWorkspaceEdit(edit, await this.updater.buildEditsForRename(oldFqcn, newFqcn));

        const dir = path.dirname(document.fileName);
        const newFilePath = path.join(dir, newName + '.php');
        const newUri = vscode.Uri.file(newFilePath);
        edit.renameFile(uri, newUri);

        return edit;
    }

    // --- Member rename ---

    private async renameMember(
        document: vscode.TextDocument,
        info: PhpFileInfo,
        member: MemberDeclaration,
        newName: string,
    ): Promise<vscode.WorkspaceEdit | undefined> {
        const oldName = member.name;
        if (oldName === newName) {
            return undefined;
        }

        const edit = new vscode.WorkspaceEdit();
        const isProperty = member.kind === 'property';

        // 1. Rename the declaration
        edit.replace(document.uri, this.memberNameRange(member), newName);

        // 2. Update references in the declaring file
        const localRefs = findMemberReferences(document, oldName, isProperty);
        for (const range of localRefs) {
            edit.replace(document.uri, range, newName);
        }

        // 3. Update references in other files that import this class (parallel)
        if (info.className) {
            const fqcn = buildFqcn(info.namespace, info.className);
            const referencingFiles = this.index.findReferencingFiles(fqcn);

            const batchSize = 50;
            for (let i = 0; i < referencingFiles.length; i += batchSize) {
                const batch = referencingFiles.slice(i, i + batchSize);
                await Promise.all(batch.map(async (entry) => {
                    try {
                        const uri = vscode.Uri.file(entry.filePath);
                        const doc = await vscode.workspace.openTextDocument(uri);
                        const refs = findMemberReferences(doc, oldName, isProperty);
                        for (const range of refs) {
                            edit.replace(uri, range, newName);
                        }
                    } catch {
                        // File may not be accessible
                    }
                }));
            }
        }

        return edit;
    }
}
