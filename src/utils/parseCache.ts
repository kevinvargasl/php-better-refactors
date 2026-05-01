import * as vscode from 'vscode';
import { PhpFileInfo } from '../types';
import { parsePhpFile } from '../parsers/phpParser';

/**
 * Caches parsed PHP documents by URI + version.
 * Keeps a small LRU to avoid repeated reparsing across common editor interactions.
 */
const MAX_CACHEABLE_ITEMS = 10_000;
const MAX_CACHE_ENTRIES = 64;

const cache = new Map<string, { version: number; info: PhpFileInfo }>();

function touch(uri: string, entry: { version: number; info: PhpFileInfo }): void {
    cache.delete(uri);
    cache.set(uri, entry);
    if (cache.size > MAX_CACHE_ENTRIES) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey) {
            cache.delete(oldestKey);
        }
    }
}

export function getCachedParse(document: vscode.TextDocument): PhpFileInfo {
    const uri = document.uri.toString();
    const version = document.version;
    const existing = cache.get(uri);
    if (existing && existing.version === version) {
        touch(uri, existing);
        return existing.info;
    }

    const info = parsePhpFile(document.getText());
    const totalItems = info.references.length + info.useStatements.length + info.members.length;
    if (totalItems <= MAX_CACHEABLE_ITEMS) {
        touch(uri, { version, info });
    } else {
        cache.delete(uri);
    }
    return info;
}
