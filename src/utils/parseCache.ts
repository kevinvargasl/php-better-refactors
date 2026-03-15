import * as vscode from 'vscode';
import { PhpFileInfo } from '../types';
import { parsePhpFile } from '../parsers/phpParser';

/**
 * Caches the parsed result of a PHP document by URI + version.
 * Avoids re-parsing the same document content multiple times
 * (e.g., prepareRename → provideRenameEdits, or frequent code action triggers).
 */
const MAX_CACHEABLE_ITEMS = 10_000;

let cached: { uri: string; version: number; info: PhpFileInfo } | undefined;

export function getCachedParse(document: vscode.TextDocument): PhpFileInfo {
    const uri = document.uri.toString();
    const version = document.version;
    if (cached && cached.uri === uri && cached.version === version) {
        return cached.info;
    }
    const info = parsePhpFile(document.getText());
    const totalItems = info.references.length + info.useStatements.length + info.members.length;
    if (totalItems <= MAX_CACHEABLE_ITEMS) {
        cached = { uri, version, info };
    } else {
        cached = undefined;
    }
    return info;
}
