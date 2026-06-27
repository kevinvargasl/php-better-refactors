import * as assert from 'assert';
import * as vscode from 'vscode';

const EXTENSION_ID = 'kevinvargasl.php-better-refactors';

describe('PHP Better Refactors integration', function () {
    this.timeout(30_000);

    let workspaceRoot: vscode.Uri;

    before(async () => {
        const folder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(folder, 'Expected the fixture workspace to be open');
        workspaceRoot = folder.uri;

        const extension = vscode.extensions.getExtension(EXTENSION_ID);
        assert.ok(extension, `Expected ${EXTENSION_ID} to be installed`);
        await extension.activate();
        await vscode.commands.executeCommand('phpBetterRefactors.reindex');
    });

    it('activates and registers the rebuild command', async () => {
        const extension = vscode.extensions.getExtension(EXTENSION_ID);
        assert.strictEqual(extension?.isActive, true);

        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('phpBetterRefactors.reindex'));
    });

    it('inserts an import after strict_types', async () => {
        const uri = await writeWorkspaceFile('scratch/ImportTarget.php', `<?php

declare(strict_types=1);

/** Import target documentation. */
final class ImportTarget
{
    public function run(): void
    {
        new User();
    }
}
`);
        const document = await vscode.workspace.openTextDocument(uri);
        const userOffset = document.getText().indexOf('User();');
        assert.notStrictEqual(userOffset, -1);
        const start = document.positionAt(userOffset);
        const range = new vscode.Range(start, start.translate(0, 'User'.length));

        const actions = await vscode.commands.executeCommand<Array<vscode.CodeAction | vscode.Command>>(
            'vscode.executeCodeActionProvider',
            uri,
            range,
            vscode.CodeActionKind.QuickFix.value
        );
        const importAction = actions?.find(
            (action): action is vscode.CodeAction =>
                action instanceof vscode.CodeAction && action.title === 'Import App\\Models\\User'
        );
        assert.ok(importAction?.edit, 'Expected an import action for App\\Models\\User');
        assert.strictEqual(await vscode.workspace.applyEdit(importAction.edit), true);

        const updated = document.getText();
        assert.ok(
            updated.indexOf('declare(strict_types=1);') < updated.indexOf('use App\\Models\\User;')
        );
        assert.ok(
            updated.indexOf('use App\\Models\\User;') < updated.indexOf('/** Import target documentation. */')
        );
    });

    it('inserts a namespace after strict_types when moving into a PSR-4 directory', async () => {
        const oldUri = await writeWorkspaceFile('legacy/TemporaryUser.php', `<?php

declare(strict_types=1);

/** Temporary user documentation. */
class TemporaryUser
{
}
`);
        const newUri = vscode.Uri.joinPath(workspaceRoot, 'src', 'TemporaryUser.php');
        const edit = new vscode.WorkspaceEdit();
        edit.renameFile(oldUri, newUri);
        assert.strictEqual(await vscode.workspace.applyEdit(edit), true);

        const updated = await readDocument(newUri);
        assert.ok(updated.indexOf('declare(strict_types=1);') < updated.indexOf('namespace App;'));
        assert.ok(updated.indexOf('namespace App;') < updated.indexOf('/** Temporary user documentation. */'));
        assert.match(updated, /namespace App;\s+\/\*\* Temporary user documentation\. \*\/\s+class TemporaryUser/);
    });

    it('renames a class, its file, and project references', async () => {
        const declarationUri = await writeWorkspaceFile('src/RenameTarget.php', `<?php

namespace App;

class RenameTarget
{
    public static function create(): RenameTarget
    {
        return new RenameTarget();
    }
}
`);
        const consumerUri = await writeWorkspaceFile('src/UsesRenameTarget.php', `<?php

namespace App;

use App\\RenameTarget;

class UsesRenameTarget
{
    public function create(): RenameTarget
    {
        return new RenameTarget();
    }
}
`);
        await vscode.commands.executeCommand('phpBetterRefactors.reindex');

        const document = await vscode.workspace.openTextDocument(declarationUri);
        const classOffset = document.getText().indexOf('RenameTarget');
        const position = document.positionAt(classOffset);
        const renameEdit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
            'vscode.executeDocumentRenameProvider',
            declarationUri,
            position,
            'RenamedTarget'
        );
        assert.ok(renameEdit, 'Expected the rename provider to return an edit');
        assert.strictEqual(await vscode.workspace.applyEdit(renameEdit), true);

        const renamedUri = vscode.Uri.joinPath(workspaceRoot, 'src', 'RenamedTarget.php');
        const renamedDeclaration = await readDocument(renamedUri);
        assert.match(renamedDeclaration, /class RenamedTarget/);
        assert.match(renamedDeclaration, /function create\(\): RenamedTarget/);
        assert.match(renamedDeclaration, /new RenamedTarget\(\)/);
        const consumer = await readDocument(consumerUri);
        assert.match(consumer, /use App\\RenamedTarget;/);
        assert.match(consumer, /new RenamedTarget\(\)/);
        await assert.rejects(async () => {
            await vscode.workspace.fs.stat(declarationUri);
        });
    });

    it('does not index files matching custom watcher exclusion globs', async () => {
        await writeWorkspaceFile('src/Hidden.generated.php', `<?php

namespace App;

class HiddenGenerated
{
}
`);
        await delay(700);

        const consumerUri = await writeWorkspaceFile('scratch/UsesHiddenGenerated.php', `<?php

class UsesHiddenGenerated
{
    public function create(): void
    {
        new HiddenGenerated();
    }
}
`);
        const document = await vscode.workspace.openTextDocument(consumerUri);
        const classOffset = document.getText().indexOf('HiddenGenerated();');
        const start = document.positionAt(classOffset);
        const range = new vscode.Range(start, start.translate(0, 'HiddenGenerated'.length));
        const actions = await vscode.commands.executeCommand<Array<vscode.CodeAction | vscode.Command>>(
            'vscode.executeCodeActionProvider',
            consumerUri,
            range,
            vscode.CodeActionKind.QuickFix.value
        );

        assert.ok(
            !actions?.some(action => action.title.includes('HiddenGenerated')),
            'Excluded declarations must not be offered as imports'
        );
    });

    async function writeWorkspaceFile(relativePath: string, content: string): Promise<vscode.Uri> {
        const uri = vscode.Uri.joinPath(workspaceRoot, ...relativePath.split('/'));
        const parent = vscode.Uri.joinPath(uri, '..');
        await vscode.workspace.fs.createDirectory(parent);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
        return uri;
    }

    async function readDocument(uri: vscode.Uri): Promise<string> {
        return (await vscode.workspace.openTextDocument(uri)).getText();
    }
});

function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}
