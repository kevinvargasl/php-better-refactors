import * as vscode from 'vscode';
import { getCachedParse } from '../utils/parseCache';
import { ReferenceIndex } from '../services/referenceIndex';
import { isPhpFile } from '../utils/pathUtils';
import { PhpFileInfo } from '../types';

/**
 * Offers "Import class" quick fixes for unresolved class references.
 * When a class name is used without a matching use statement and the class
 * exists in the project index, suggests adding a use statement.
 */
export class ImportClassProvider implements vscode.CodeActionProvider {
    static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

    constructor(private index: ReferenceIndex) {}

    async provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
    ): Promise<vscode.CodeAction[] | undefined> {
        if (!isPhpFile(document.fileName)) {
            return;
        }

        const info = getCachedParse(document);
        const actions: vscode.CodeAction[] = [];
        let insertPosition: vscode.Position | undefined;

        for (const ref of info.references) {
            if (ref.name.includes('\\')) {
                continue;
            }

            const refLine = ref.loc.startLine - 1;
            if (range.start.line !== refLine) {
                continue;
            }
            if (range.start.character > ref.loc.endColumn || range.end.character < ref.loc.startColumn) {
                continue;
            }

            if (info.useStatements.some(use => use.shortName === ref.name)) {
                continue;
            }

            if (this.index.getFileForFqcn(ref.resolvedFqcn)) {
                continue;
            }

            let candidates = this.index.findFqcnsByShortName(ref.name);
            if (candidates.length === 0) {
                candidates = await this.index.discoverVendorFqcnsByShortName(ref.name);
            }
            if (candidates.length === 0) {
                continue;
            }

            if (!insertPosition) {
                insertPosition = this.findUseInsertPosition(info, document);
            }

            for (const fqcn of candidates) {
                const action = new vscode.CodeAction(
                    `Import ${fqcn}`,
                    vscode.CodeActionKind.QuickFix
                );

                const edit = new vscode.WorkspaceEdit();
                const prefix = info.useStatements.length === 0 && !info.namespaceLoc ? '\n' : '';
                edit.insert(document.uri, insertPosition, `${prefix}use ${fqcn};\n`);
                action.edit = edit;

                if (candidates.length === 1) {
                    action.isPreferred = true;
                }

                actions.push(action);
            }
        }

        return actions.length > 0 ? actions : undefined;
    }

    private findUseInsertPosition(info: PhpFileInfo, document: vscode.TextDocument): vscode.Position {
        if (info.useStatements.length > 0) {
            const lastLine = Math.max(...info.useStatements.map(use => use.loc.endLine));
            for (let i = lastLine - 1; i < document.lineCount; i++) {
                const lineText = document.lineAt(i).text;
                if (lineText.includes(';')) {
                    return new vscode.Position(i + 1, 0);
                }
            }
            return new vscode.Position(lastLine, 0);
        }

        if (info.namespaceLoc) {
            return new vscode.Position(info.namespaceLoc.endLine, 0);
        }

        if (info.preambleInsertPosition) {
            return new vscode.Position(
                info.preambleInsertPosition.line - 1,
                info.preambleInsertPosition.column
            );
        }

        return new vscode.Position(1, 0);
    }
}
