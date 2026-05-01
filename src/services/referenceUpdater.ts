import * as vscode from 'vscode';
import { ReferenceIndex } from './referenceIndex';
import { getShortName } from '../utils/phpStringUtils';
import { UseStatement, ClassReference, IndexEntry, PhpLocation } from '../types';
import { locToRange } from '../utils/workspaceEditUtils';
import { formatError } from '../utils/errorUtils';
import { findOpenFileDocument, readTextFilePreferOpenDocument } from '../utils/documentUtils';
import { getCachedParse } from '../utils/parseCache';

interface ParsedEntry {
    entry: IndexEntry;
    uri: vscode.Uri;
    document: vscode.TextDocument | null;
    useStatements: UseStatement[];
    references: ClassReference[];
}

/**
 * Builds WorkspaceEdits for bulk reference updates when a class is renamed or moved.
 */
export class ReferenceUpdater {
    constructor(private index: ReferenceIndex) {}

    /**
     * Build a WorkspaceEdit that updates all references from oldFqcn to newFqcn.
     * Uses indexed analysis for closed files and fresh parses for open documents.
     */
    async buildEditsForRename(oldFqcn: string, newFqcn: string): Promise<vscode.WorkspaceEdit> {
        const edit = new vscode.WorkspaceEdit();
        const oldShort = getShortName(oldFqcn);
        const newShort = getShortName(newFqcn);
        const shortNameChanged = oldShort !== newShort;

        const referencingFiles = this.index.findReferencingFiles(oldFqcn);
        if (referencingFiles.length === 0) {
            return edit;
        }

        // Analyze open documents live, but reuse indexed data for closed files.
        const parsed = await this.fetchAndParseAll(referencingFiles);
        const lineCache = new Map<string, string[]>();

        for (const { uri, document, useStatements, references } of parsed) {
            // Update use statements
            for (const use of useStatements) {
                if (use.fqcn !== oldFqcn) {
                    continue;
                }

                const useRange = locToRange(use.loc);

                if (use.alias) {
                    edit.replace(uri, useRange, this.buildUseStatementText(newFqcn, use.alias, use.groupPrefix));
                } else if (use.groupPrefix) {
                    const groupPrefixWithSep = use.groupPrefix.endsWith('\\')
                        ? use.groupPrefix
                        : use.groupPrefix + '\\';
                    if (newFqcn.startsWith(groupPrefixWithSep)) {
                        const newItemName = newFqcn.substring(groupPrefixWithSep.length);
                        edit.replace(uri, useRange, newItemName);
                    } else {
                        await this.removeGroupItemAndAddUse(edit, uri, use, useStatements, newFqcn, document, lineCache);
                    }
                } else {
                    edit.replace(uri, useRange, newFqcn);
                }

                if (shortNameChanged && !use.alias) {
                    this.updateShortNameUsages(edit, references, oldFqcn, oldShort, newShort, uri);
                }
            }

            // Update inline fully-qualified references
            for (const ref of references) {
                if (ref.resolvedFqcn !== oldFqcn) {
                    continue;
                }
                const strippedRef = ref.name.startsWith('\\') ? ref.name.substring(1) : ref.name;
                if (strippedRef === oldFqcn) {
                    const prefix = ref.name.startsWith('\\') ? '\\' : '';
                    edit.replace(uri, locToRange(ref.loc), prefix + newFqcn);
                }
            }
        }

        return edit;
    }

    /**
     * Reuse indexed analysis for closed files and only re-parse currently open documents.
     */
    private async fetchAndParseAll(entries: IndexEntry[]): Promise<ParsedEntry[]> {
        const batchSize = 50;
        const results: ParsedEntry[] = [];

        for (let i = 0; i < entries.length; i += batchSize) {
            const batch = entries.slice(i, i + batchSize);
            const batchResults = await Promise.all(batch.map(async (entry) => {
                const uri = vscode.Uri.file(entry.filePath);
                const openDocument = findOpenFileDocument(entry.filePath) ?? null;

                if (openDocument) {
                    try {
                        const freshInfo = getCachedParse(openDocument);
                        return {
                            entry, uri, document: openDocument,
                            useStatements: freshInfo.useStatements,
                            references: freshInfo.references,
                        };
                    } catch (error) {
                        console.warn('PHP Better Refactors: Failed to parse open file for reference update:', entry.filePath, formatError(error));
                    }
                }

                return {
                    entry, uri, document: openDocument,
                    useStatements: entry.useStatements,
                    references: entry.references,
                };
            }));
            results.push(...batchResults);
        }

        return results;
    }

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
                edit.replace(uri, locToRange(ref.loc), newShort);
            }
        }
    }

    /**
     * Remove an item from a group use statement and add a standalone use line.
     */
    private async removeGroupItemAndAddUse(
        edit: vscode.WorkspaceEdit,
        uri: vscode.Uri,
        use: UseStatement,
        allUseStatements: UseStatement[],
        newFqcn: string,
        document: vscode.TextDocument | null,
        lineCache: Map<string, string[]>,
    ): Promise<void> {
        const line = use.loc.startLine - 1;
        const lineText = await this.getLineText(uri.fsPath, line, document, lineCache);

        // Count how many items share this group prefix (early exit)
        let groupCount = 0;
        for (const stmt of allUseStatements) {
            if (stmt.groupPrefix === use.groupPrefix && ++groupCount > 1) { break; }
        }

        if (groupCount <= 1) {
            const lineRange = new vscode.Range(line, 0, line + 1, 0);
            edit.replace(uri, lineRange, `use ${newFqcn};\n`);
            return;
        }

        const startCol = use.loc.startColumn;
        const endCol = use.loc.endColumn;
        const charBefore2 = lineText[startCol - 2] || '';
        const charBefore1 = lineText[startCol - 1] || '';
        const charAfter = lineText[endCol] || '';

        let removeStart = startCol;
        let removeEnd = endCol;

        if (charBefore1 === ' ' && charBefore2 === ',') {
            removeStart = startCol - 2;
        } else if (charAfter === ',') {
            removeEnd = endCol + 1;
            if (lineText[removeEnd] === ' ') {
                removeEnd++;
            }
        }

        const removeRange = new vscode.Range(line, removeStart, line, removeEnd);
        edit.replace(uri, removeRange, '');
        edit.insert(uri, new vscode.Position(line + 1, 0), `use ${newFqcn};\n`);
    }

    private async getLineText(
        filePath: string,
        line: number,
        document: vscode.TextDocument | null,
        lineCache: Map<string, string[]>,
    ): Promise<string> {
        if (document) {
            return line < document.lineCount ? document.lineAt(line).text : '';
        }

        let lines = lineCache.get(filePath);
        if (!lines) {
            const content = await readTextFilePreferOpenDocument(filePath);
            lines = content.split(/\r?\n/);
            lineCache.set(filePath, lines);
        }

        return lines[line] ?? '';
    }

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

    buildNamespaceEditFromInfo(
        filePath: string,
        currentNamespaceLoc: PhpLocation | null,
        currentNamespace: string | null,
        newNamespace: string
    ): vscode.WorkspaceEdit {
        const edit = new vscode.WorkspaceEdit();
        const uri = vscode.Uri.file(filePath);

        if (currentNamespaceLoc && currentNamespace) {
            edit.replace(uri, locToRange(currentNamespaceLoc), `namespace ${newNamespace};`);
        } else if (!currentNamespace && newNamespace) {
            edit.insert(uri, new vscode.Position(1, 0), `\nnamespace ${newNamespace};\n`);
        }

        return edit;
    }

    buildClassRenameEdit(
        filePath: string,
        classLoc: PhpLocation,
        oldClassName: string,
        newClassName: string
    ): vscode.WorkspaceEdit {
        const edit = new vscode.WorkspaceEdit();
        const uri = vscode.Uri.file(filePath);
        edit.replace(uri, locToRange(classLoc), newClassName);
        return edit;
    }
}
