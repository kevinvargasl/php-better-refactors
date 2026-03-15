import * as vscode from 'vscode';
import { parsePhpFile } from '../parsers/phpParser';
import { ReferenceIndex } from '../services/referenceIndex';
import { isPhpFile } from '../utils/pathUtils';
import { getShortName } from '../utils/phpStringUtils';

/**
 * Offers "Import class" quick fixes for unresolved class references.
 * When a class name is used without a matching use statement and the class
 * exists in the project index, suggests adding a use statement.
 */
export class ImportClassProvider implements vscode.CodeActionProvider {
    static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

    constructor(private index: ReferenceIndex) {}

    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
    ): vscode.CodeAction[] | undefined {
        if (!isPhpFile(document.fileName)) {
            return;
        }

        const info = parsePhpFile(document.getText());
        const actions: vscode.CodeAction[] = [];

        for (const ref of info.references) {
            // Only consider short names (no backslash = not fully qualified)
            if (ref.name.includes('\\')) {
                continue;
            }

            // Skip if cursor isn't on this reference
            const refLine = ref.loc.startLine - 1;
            if (range.start.line !== refLine) {
                continue;
            }
            if (range.start.character > ref.loc.endColumn || range.end.character < ref.loc.startColumn) {
                continue;
            }

            // Skip if already imported via use statement
            const alreadyImported = info.useStatements.some(u => u.shortName === ref.name);
            if (alreadyImported) {
                continue;
            }

            // Skip if the resolved FQCN exists in the index (same-namespace class)
            if (this.index.getFileForFqcn(ref.resolvedFqcn)) {
                continue;
            }

            // Search the index for classes matching this short name
            const candidates = this.index.findFqcnsByShortName(ref.name);
            if (candidates.length === 0) {
                continue;
            }

            // Find where to insert the use statement
            const insertPosition = this.findUseInsertPosition(info, document);

            for (const fqcn of candidates) {
                const action = new vscode.CodeAction(
                    `Import ${fqcn}`,
                    vscode.CodeActionKind.QuickFix
                );

                const edit = new vscode.WorkspaceEdit();
                edit.insert(document.uri, insertPosition, `use ${fqcn};\n`);
                action.edit = edit;

                // If only one candidate, mark as preferred
                if (candidates.length === 1) {
                    action.isPreferred = true;
                }

                actions.push(action);
            }
        }

        return actions.length > 0 ? actions : undefined;
    }

    /**
     * Find the position to insert a new use statement.
     * After the last existing use statement, or after the namespace declaration,
     * or after <?php.
     */
    private findUseInsertPosition(
        info: ReturnType<typeof parsePhpFile>,
        document: vscode.TextDocument,
    ): vscode.Position {
        // After the last use statement
        if (info.useStatements.length > 0) {
            let lastLine = 0;
            for (const use of info.useStatements) {
                if (use.loc.endLine > lastLine) {
                    lastLine = use.loc.endLine;
                }
            }
            // The use statement loc endLine might not include the full "use ...;" line
            // for group items. Scan forward to find the actual semicolon line.
            for (let i = lastLine - 1; i < document.lineCount; i++) {
                const lineText = document.lineAt(i).text;
                if (lineText.includes(';')) {
                    return new vscode.Position(i + 1, 0);
                }
            }
            return new vscode.Position(lastLine, 0);
        }

        // After the namespace declaration
        if (info.namespaceLoc) {
            return new vscode.Position(info.namespaceLoc.endLine, 0);
        }

        // After <?php
        return new vscode.Position(1, 0);
    }
}
