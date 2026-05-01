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
import { formatError } from './utils/errorUtils';
import { readTextFilePreferOpenDocument } from './utils/documentUtils';

const COMPOSER_RELOAD_DEBOUNCE_MS = 300;

let referenceIndex: ReferenceIndex | undefined;
let composerReloadTimer: NodeJS.Timeout | undefined;

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
    const scheduleComposerReload = (): void => {
        if (composerReloadTimer) {
            clearTimeout(composerReloadTimer);
        }
        composerReloadTimer = setTimeout(() => {
            composerReloadTimer = undefined;
            void loadPsr4Mappings(resolver);
        }, COMPOSER_RELOAD_DEBOUNCE_MS);
    };
    composerWatcher.onDidChange(scheduleComposerReload);
    composerWatcher.onDidCreate(scheduleComposerReload);
    composerWatcher.onDidDelete(scheduleComposerReload);
    context.subscriptions.push(composerWatcher, { dispose: () => {
        if (composerReloadTimer) {
            clearTimeout(composerReloadTimer);
            composerReloadTimer = undefined;
        }
    } });

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
    if (composerReloadTimer) {
        clearTimeout(composerReloadTimer);
        composerReloadTimer = undefined;
    }
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
                const content = await readTextFilePreferOpenDocument(composerPath);
                const mappings = parseComposerJson(content, path.dirname(composerPath));
                allMappings.push(...mappings);
            } catch (error) {
                console.warn('PHP Better Refactors: Failed to read composer.json:', composerPath, formatError(error));
            }
        }

        resolver.setMappings(allMappings);
    } catch (error) {
        console.warn('PHP Better Refactors: Failed to discover composer.json files:', formatError(error));
    }
}
