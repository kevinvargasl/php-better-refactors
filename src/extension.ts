import * as vscode from 'vscode';
import * as path from 'path';
import { parseComposerJson } from './parsers/composerParser';
import { Psr4Resolver } from './services/psr4Resolver';
import { ReferenceIndex } from './services/referenceIndex';
import { ReferenceUpdater } from './services/referenceUpdater';
import { FileRenameHandler } from './handlers/fileRenameHandler';
import { PhpClassRenameProvider } from './providers/renameProvider';
import { ImportClassProvider } from './providers/importClassProvider';
import { Psr4Mapping, ExtensionConfig } from './types';

let referenceIndex: ReferenceIndex | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const config = getConfig();

    // Initialize PSR-4 resolver
    const resolver = new Psr4Resolver();
    await loadPsr4Mappings(resolver);

    // Initialize reference index
    referenceIndex = new ReferenceIndex(config.excludePatterns);

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Window,
            title: 'PHP Better Refactors: Indexing PHP files...',
        },
        () => referenceIndex!.buildIndex()
    );

    referenceIndex.startWatching();
    context.subscriptions.push(referenceIndex);

    const updater = new ReferenceUpdater(referenceIndex);

    // Single handler for both renames and moves
    if (config.enableAutoRename || config.enableAutoNamespace) {
        const handler = new FileRenameHandler(updater,
            config.enableAutoNamespace ? resolver : null,
            { rename: config.enableAutoRename, move: config.enableAutoNamespace });
        context.subscriptions.push(handler.register());
    }

    // Rename Symbol provider (F2 / right-click → Rename Symbol)
    context.subscriptions.push(
        vscode.languages.registerRenameProvider(
            { language: 'php', scheme: 'file' },
            new PhpClassRenameProvider(referenceIndex, updater)
        )
    );

    // Import class quick fix (adds use statement for unresolved class references)
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            { language: 'php', scheme: 'file' },
            new ImportClassProvider(referenceIndex),
            { providedCodeActionKinds: ImportClassProvider.providedCodeActionKinds }
        )
    );

    // Watch for composer.json changes to reload PSR-4 mappings
    const composerWatcher = vscode.workspace.createFileSystemWatcher('**/composer.json');
    composerWatcher.onDidChange(() => loadPsr4Mappings(resolver));
    composerWatcher.onDidCreate(() => loadPsr4Mappings(resolver));
    composerWatcher.onDidDelete(() => loadPsr4Mappings(resolver));
    context.subscriptions.push(composerWatcher);

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('phpBetterRefactors')) {
                vscode.window.showInformationMessage(
                    'PHP Better Refactors: Configuration changed. Please reload the window for changes to take effect.'
                );
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('phpBetterRefactors.reindex', async () => {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Window,
                    title: 'PHP Better Refactors: Re-indexing PHP files...',
                },
                async () => {
                    await loadPsr4Mappings(resolver);
                    await referenceIndex!.buildIndex();
                }
            );
            vscode.window.showInformationMessage('PHP Better Refactors: Index rebuilt.');
        })
    );
}

export function deactivate(): void {
    referenceIndex?.dispose();
}

function getConfig(): ExtensionConfig {
    const config = vscode.workspace.getConfiguration('phpBetterRefactors');
    return {
        enableAutoRename: config.get<boolean>('enableAutoRename', true),
        enableAutoNamespace: config.get<boolean>('enableAutoNamespace', true),
        excludePatterns: config.get<string[]>('excludePatterns', ['**/vendor/**', '**/node_modules/**']),
    };
}

async function findComposerFiles(): Promise<string[]> {
    const uris = await vscode.workspace.findFiles('**/composer.json', '**/vendor/**');
    return uris.map(uri => uri.fsPath);
}

async function loadPsr4Mappings(resolver: Psr4Resolver): Promise<void> {
    try {
        const composerFiles = await findComposerFiles();
        const allMappings: Psr4Mapping[] = [];

        for (const composerPath of composerFiles) {
            try {
                const document = await vscode.workspace.openTextDocument(composerPath);
                const content = document.getText();
                const mappings = parseComposerJson(content, path.dirname(composerPath));
                allMappings.push(...mappings);
            } catch {
                // Skip invalid composer.json files
            }
        }

        resolver.setMappings(allMappings);
    } catch {
        // No composer files found - PSR-4 features disabled
    }
}
