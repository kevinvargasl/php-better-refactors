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
        await delay(400);
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

    it('discovers vendor classes lazily for import actions', async () => {
        await writeWorkspaceFile('vendor/acme/package/src/LazyVendorThing.php', `<?php

namespace Acme\\Package;

class LazyVendorThing
{
}
`);
        const consumerUri = await writeWorkspaceFile('scratch/UsesLazyVendorThing.php', `<?php

class UsesLazyVendorThing
{
    public function create(): void
    {
        new LazyVendorThing();
    }
}
`);
        const document = await vscode.workspace.openTextDocument(consumerUri);
        await delay(400);
        const classOffset = document.getText().indexOf('LazyVendorThing();');
        const start = document.positionAt(classOffset);
        const range = new vscode.Range(start, start.translate(0, 'LazyVendorThing'.length));

        const actions = await vscode.commands.executeCommand<Array<vscode.CodeAction | vscode.Command>>(
            'vscode.executeCodeActionProvider',
            consumerUri,
            range,
            vscode.CodeActionKind.QuickFix.value
        );

        assert.ok(
            actions?.some(action => action.title === 'Import Acme\\Package\\LazyVendorThing'),
            'Expected an import action for the lazily discovered vendor class'
        );
    });

    it('rewrites a single-item multiline group import safely when moving a class', async () => {
        const oldUri = await writeWorkspaceFile('src/Models/GroupedTarget.php', [
            '<?php',
            '',
            'namespace App\\Models;',
            '',
            'class GroupedTarget {}',
            '',
        ].join('\n'));
        const consumerUri = await writeWorkspaceFile('src/UsesGroupedTarget.php', [
            '<?php',
            '',
            'namespace App;',
            '',
            'use App\\Models\\{',
            '    GroupedTarget as TargetAlias',
            '};',
            '',
            'new TargetAlias();',
            '',
        ].join('\n'));
        await vscode.commands.executeCommand('phpBetterRefactors.reindex');

        const newUri = vscode.Uri.joinPath(workspaceRoot, 'src', 'Services', 'GroupedTarget.php');
        const edit = new vscode.WorkspaceEdit();
        edit.renameFile(oldUri, newUri);
        assert.strictEqual(await vscode.workspace.applyEdit(edit), true);

        const movedClass = await readDocument(newUri);
        const consumer = await readDocument(consumerUri);
        assert.match(movedClass, /namespace App\\Services;/);
        assert.match(consumer, /use App\\Services\\GroupedTarget as TargetAlias;/);
        assert.doesNotMatch(consumer, /use App\\Models\\\{/);
    });

    it('does not infer a class from the filename when moving a PHP script', async () => {
        const oldUri = await writeWorkspaceFile('legacy/Utility.php', [
            '<?php',
            '',
            'namespace Legacy;',
            '',
            'function utility(): void {}',
            '',
        ].join('\n'));
        const consumerUri = await writeWorkspaceFile('src/UsesLegacyUtility.php', [
            '<?php',
            '',
            'namespace App;',
            '',
            'use Legacy\\Utility;',
            '',
            'new Utility();',
            '',
        ].join('\n'));
        await vscode.commands.executeCommand('phpBetterRefactors.reindex');

        const newUri = vscode.Uri.joinPath(workspaceRoot, 'src', 'Utility.php');
        const edit = new vscode.WorkspaceEdit();
        edit.renameFile(oldUri, newUri);
        assert.strictEqual(await vscode.workspace.applyEdit(edit), true);

        const movedScript = await readDocument(newUri);
        const consumer = await readDocument(consumerUri);
        assert.match(movedScript, /namespace Legacy;/);
        assert.doesNotMatch(movedScript, /namespace App;/);
        assert.match(consumer, /use Legacy\\Utility;/);
    });

    it('renames only provably typed member references without opening referenced files', async () => {
        const declarationUri = await writeWorkspaceFile('src/MemberOwner.php', `<?php

namespace App;

class MemberOwner
{
    public function save(): void
    {
    }
}
`);
        const consumerUri = await writeWorkspaceFile('src/UsesMemberOwner.php', `<?php

namespace App;

use App\\MemberOwner;

class UsesMemberOwner
{
    public function run(MemberOwner $owner): void
    {
        $owner->save();
        $other->save();
        MemberOwner::save();
        $fresh = new MemberOwner();
        $fresh->save();
        // $other->save();
        $message = '$other->save()';
    }
}
`);
        await vscode.commands.executeCommand('phpBetterRefactors.reindex');
        assert.ok(
            !vscode.workspace.textDocuments.some(document => document.uri.toString() === consumerUri.toString()),
            'The consumer should begin closed'
        );

        const declaration = await vscode.workspace.openTextDocument(declarationUri);
        const methodOffset = declaration.getText().indexOf('save()');
        const renameEdit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
            'vscode.executeDocumentRenameProvider',
            declarationUri,
            declaration.positionAt(methodOffset),
            'persist'
        );

        assert.ok(renameEdit, 'Expected a member rename edit');
        assert.ok(
            !vscode.workspace.textDocuments.some(document => document.uri.toString() === consumerUri.toString()),
            'Preparing the rename should not open the consumer document'
        );
        assert.strictEqual(await vscode.workspace.applyEdit(renameEdit), true);

        const updatedConsumer = await readDocument(consumerUri);
        assert.match(updatedConsumer, /\$owner->persist\(\)/);
        assert.match(updatedConsumer, /MemberOwner::persist\(\)/);
        assert.match(updatedConsumer, /\$fresh->persist\(\)/);
        assert.match(updatedConsumer, /\$other->save\(\)/);
        assert.match(updatedConsumer, /\/\/ \$other->save\(\)/);
        assert.match(updatedConsumer, /\$message = '\$other->save\(\)'/);
    });

    it('preserves the dollar sign when renaming typed static property references', async () => {
        const declarationUri = await writeWorkspaceFile('src/PropertyOwner.php', [
            '<?php',
            '',
            'namespace App;',
            '',
            'class PropertyOwner',
            '{',
            '    public static string $status;',
            '    public string $instanceStatus;',
            '}',
            '',
        ].join('\n'));
        const consumerUri = await writeWorkspaceFile('src/UsesPropertyOwner.php', [
            '<?php',
            '',
            'namespace App;',
            '',
            'use App\\PropertyOwner;',
            '',
            'function inspect(PropertyOwner $owner): void',
            '{',
            '    echo PropertyOwner::$status;',
            '    echo $owner->status;',
            '    echo $other->status;',
            '}',
            '',
        ].join('\n'));
        await vscode.commands.executeCommand('phpBetterRefactors.reindex');

        const declaration = await vscode.workspace.openTextDocument(declarationUri);
        const propertyOffset = declaration.getText().indexOf('$status') + 1;
        const renameEdit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
            'vscode.executeDocumentRenameProvider',
            declarationUri,
            declaration.positionAt(propertyOffset),
            'state'
        );
        assert.ok(renameEdit, 'Expected a property rename edit');
        assert.strictEqual(await vscode.workspace.applyEdit(renameEdit), true);

        const updatedConsumer = await readDocument(consumerUri);
        assert.match(updatedConsumer, /PropertyOwner::\$state/);
        assert.match(updatedConsumer, /\$other->status/);
    });

    it('renames typed class constants and only their resolved references', async () => {
        const declarationUri = await writeWorkspaceFile('src/ChangesView.php', [
            '<?php',
            '',
            'namespace App;',
            '',
            'final class ChangesView',
            '{',
            '    public const array CURRENCY_FIELDS = [];',
            '',
            '    public function contains(string $field): bool',
            '    {',
            '        return in_array($field, self::CURRENCY_FIELDS, true);',
            '    }',
            '}',
            '',
        ].join('\n'));
        const consumerUri = await writeWorkspaceFile('src/UsesChangesViewConstant.php', [
            '<?php',
            '',
            'namespace App;',
            '',
            'use App\\ChangesView;',
            '',
            '$fields = ChangesView::CURRENCY_FIELDS;',
            '$unrelated = Other::CURRENCY_FIELDS;',
            '$text = "ChangesView::CURRENCY_FIELDS";',
            '// ChangesView::CURRENCY_FIELDS',
            '',
        ].join('\n'));
        await vscode.commands.executeCommand('phpBetterRefactors.reindex');

        const declaration = await vscode.workspace.openTextDocument(declarationUri);
        const constantOffset = declaration.getText().indexOf('CURRENCY_FIELDS');
        const renameEdit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
            'vscode.executeDocumentRenameProvider',
            declarationUri,
            declaration.positionAt(constantOffset),
            'MONEY_FIELDS'
        );
        assert.ok(renameEdit, 'Expected a class constant rename edit');
        assert.strictEqual(await vscode.workspace.applyEdit(renameEdit), true);

        const updatedDeclaration = await readDocument(declarationUri);
        const updatedConsumer = await readDocument(consumerUri);
        assert.match(updatedDeclaration, /const array MONEY_FIELDS/);
        assert.match(updatedDeclaration, /self::MONEY_FIELDS/);
        assert.match(updatedConsumer, /ChangesView::MONEY_FIELDS/);
        assert.match(updatedConsumer, /Other::CURRENCY_FIELDS/);
        assert.match(updatedConsumer, /\"ChangesView::CURRENCY_FIELDS\"/);
        assert.match(updatedConsumer, /\/\/ ChangesView::CURRENCY_FIELDS/);
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
