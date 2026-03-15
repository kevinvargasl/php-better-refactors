import * as vscode from 'vscode';
import { ReferenceIndex } from './referenceIndex';
import { parsePhpFile } from '../parsers/phpParser';
import { getShortName } from '../utils/phpStringUtils';
import { UseStatement, ClassReference } from '../types';

/**
 * Builds WorkspaceEdits for bulk reference updates when a class is renamed or moved.
 */
export class ReferenceUpdater {
    constructor(private index: ReferenceIndex) {}

    /**
     * Build a WorkspaceEdit that updates all references from oldFqcn to newFqcn.
     * Re-parses each referencing file to get fresh locations (handles unsaved edits).
     */
    async buildEditsForRename(oldFqcn: string, newFqcn: string): Promise<vscode.WorkspaceEdit> {
        const edit = new vscode.WorkspaceEdit();
        const oldShort = getShortName(oldFqcn);
        const newShort = getShortName(newFqcn);
        const shortNameChanged = oldShort !== newShort;

        const referencingFiles = this.index.findReferencingFiles(oldFqcn);

        for (const entry of referencingFiles) {
            const uri = vscode.Uri.file(entry.filePath);

            // Re-parse current buffer to get fresh locations
            let useStatements: UseStatement[];
            let references: ClassReference[];
            let docText = '';
            try {
                const doc = await vscode.workspace.openTextDocument(uri);
                docText = doc.getText();
                const freshInfo = parsePhpFile(docText);
                useStatements = freshInfo.useStatements;
                references = freshInfo.references;
            } catch {
                // File may have been deleted; fall back to index data
                useStatements = entry.useStatements;
                references = entry.references;
            }

            // Update use statements
            for (const use of useStatements) {
                if (use.fqcn !== oldFqcn) {
                    continue;
                }

                // Replace the FQCN in the use statement
                const useRange = new vscode.Range(
                    use.loc.startLine - 1, use.loc.startColumn,
                    use.loc.endLine - 1, use.loc.endColumn
                );

                if (use.alias) {
                    edit.replace(uri, useRange, this.buildUseStatementText(newFqcn, use.alias, use.groupPrefix));
                } else if (use.groupPrefix) {
                    // Group use statement - update the item within the group
                    const groupPrefixWithSep = use.groupPrefix.endsWith('\\')
                        ? use.groupPrefix
                        : use.groupPrefix + '\\';
                    if (newFqcn.startsWith(groupPrefixWithSep)) {
                        const newItemName = newFqcn.substring(groupPrefixWithSep.length);
                        edit.replace(uri, useRange, newItemName);
                    } else {
                        // New FQCN doesn't share the group prefix.
                        // Remove item from group and add a standalone use statement.
                        this.removeGroupItemAndAddUse(edit, uri, use, useStatements, newFqcn, docText);
                    }
                } else {
                    // Simple use statement - replace FQCN
                    edit.replace(uri, useRange, newFqcn);
                }

                // If short name changed and no alias, update all usages of the short name
                if (shortNameChanged && !use.alias) {
                    this.updateShortNameUsages(edit, references, oldFqcn, oldShort, newShort, uri);
                }
            }

            // Update inline fully-qualified references (\App\Models\User)
            for (const ref of references) {
                if (ref.resolvedFqcn !== oldFqcn) {
                    continue;
                }

                const refName = ref.name;
                const strippedRef = refName.startsWith('\\') ? refName.substring(1) : refName;

                if (strippedRef === oldFqcn) {
                    const range = new vscode.Range(
                        ref.loc.startLine - 1, ref.loc.startColumn,
                        ref.loc.endLine - 1, ref.loc.endColumn
                    );
                    const prefix = refName.startsWith('\\') ? '\\' : '';
                    edit.replace(uri, range, prefix + newFqcn);
                }
            }
        }

        return edit;
    }

    /**
     * Update all usages of a short class name within a file.
     */
    private updateShortNameUsages(
        edit: vscode.WorkspaceEdit,
        references: ClassReference[],
        oldFqcn: string,
        oldShort: string,
        newShort: string,
        uri: vscode.Uri
    ): void {
        for (const ref of references) {
            if (ref.name === oldShort && ref.resolvedFqcn === oldFqcn) {
                const range = new vscode.Range(
                    ref.loc.startLine - 1, ref.loc.startColumn,
                    ref.loc.endLine - 1, ref.loc.endColumn
                );
                edit.replace(uri, range, newShort);
            }
        }
    }

    /**
     * Remove an item from a group use statement and add a standalone use line.
     */
    private removeGroupItemAndAddUse(
        edit: vscode.WorkspaceEdit,
        uri: vscode.Uri,
        use: UseStatement,
        allUseStatements: UseStatement[],
        newFqcn: string,
        docText: string,
    ): void {
        const line = use.loc.startLine - 1;
        const lineText = docText.split('\n')[line] || '';

        // Count how many items share this group prefix
        const sameGroupItems = allUseStatements.filter(u => u.groupPrefix === use.groupPrefix);

        if (sameGroupItems.length <= 1) {
            // Only item in the group — replace the entire use statement line
            const lineRange = new vscode.Range(line, 0, line + 1, 0);
            edit.replace(uri, lineRange, `use ${newFqcn};\n`);
            return;
        }

        // Multiple items: remove this item (with its comma) from the group
        const startCol = use.loc.startColumn;
        const endCol = use.loc.endColumn;
        const charBefore2 = lineText[startCol - 2] || '';
        const charBefore1 = lineText[startCol - 1] || '';
        const charAfter = lineText[endCol] || '';

        let removeStart = startCol;
        let removeEnd = endCol;

        if (charBefore1 === ' ' && charBefore2 === ',') {
            // Middle or last item: remove preceding ", "
            removeStart = startCol - 2;
        } else if (charAfter === ',') {
            // First item: remove trailing ","  and optional space
            removeEnd = endCol + 1;
            if (lineText[removeEnd] === ' ') {
                removeEnd++;
            }
        }

        const removeRange = new vscode.Range(line, removeStart, line, removeEnd);
        edit.replace(uri, removeRange, '');

        // Add a new standalone use statement after this line
        edit.insert(uri, new vscode.Position(line + 1, 0), `use ${newFqcn};\n`);
    }

    /**
     * Build the text for a use statement replacement.
     */
    private buildUseStatementText(fqcn: string, alias: string | null, groupPrefix?: string): string {
        if (groupPrefix) {
            const prefixWithSep = groupPrefix.endsWith('\\') ? groupPrefix : groupPrefix + '\\';
            const itemName = fqcn.startsWith(prefixWithSep)
                ? fqcn.substring(prefixWithSep.length)
                : fqcn;
            return alias ? `${itemName} as ${alias}` : itemName;
        }
        return alias ? `${fqcn} as ${alias}` : fqcn;
    }

    /**
     * Build edits to update namespace declaration using file info.
     */
    buildNamespaceEditFromInfo(
        filePath: string,
        currentNamespaceLoc: { startLine: number; startColumn: number; endLine: number; endColumn: number } | null,
        currentNamespace: string | null,
        newNamespace: string
    ): vscode.WorkspaceEdit {
        const edit = new vscode.WorkspaceEdit();
        const uri = vscode.Uri.file(filePath);

        if (currentNamespaceLoc && currentNamespace) {
            // Replace existing namespace
            const range = new vscode.Range(
                currentNamespaceLoc.startLine - 1, currentNamespaceLoc.startColumn,
                currentNamespaceLoc.endLine - 1, currentNamespaceLoc.endColumn
            );
            edit.replace(uri, range, `namespace ${newNamespace};`);
        } else if (!currentNamespace && newNamespace) {
            // Insert namespace after <?php
            edit.insert(uri, new vscode.Position(1, 0), `\nnamespace ${newNamespace};\n`);
        }

        return edit;
    }

    /**
     * Build edits to rename the class declaration in a file.
     */
    buildClassRenameEdit(
        filePath: string,
        classLoc: { startLine: number; startColumn: number; endLine: number; endColumn: number },
        oldClassName: string,
        newClassName: string
    ): vscode.WorkspaceEdit {
        const edit = new vscode.WorkspaceEdit();
        const uri = vscode.Uri.file(filePath);

        const range = new vscode.Range(
            classLoc.startLine - 1, classLoc.startColumn,
            classLoc.endLine - 1, classLoc.endColumn
        );
        edit.replace(uri, range, newClassName);

        return edit;
    }
}
