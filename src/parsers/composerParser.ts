import type { Psr4Mapping } from '../types';
import { formatError } from '../utils/errorUtils';

interface ComposerAutoload {
    'psr-4'?: Record<string, string | string[]>;
}

interface ComposerJson {
    autoload?: ComposerAutoload;
    'autoload-dev'?: ComposerAutoload;
}

const VALID_PSR4_PREFIX = /^[A-Za-z_\\][A-Za-z0-9_\\]*\\$/;

/**
 * Normalize a directory path to always end with '/'.
 */
function normalizeDir(dir: string): string {
    if (dir === '') {
        return '/';
    }
    return dir.endsWith('/') ? dir : dir + '/';
}

function isValidDirectory(dir: string): boolean {
    if (typeof dir !== 'string' || dir.length === 0) {
        return false;
    }
    // Reject path traversal attempts
    const normalized = dir.replace(/\\/g, '/');
    return !normalized.split('/').some(segment => segment === '..');
}

/**
 * Extract PSR-4 mappings from an autoload section.
 */
function extractMappings(
    psr4: Record<string, string | string[]>,
    composerDir: string,
): Psr4Mapping[] {
    const mappings: Psr4Mapping[] = [];

    for (const [prefix, dirs] of Object.entries(psr4)) {
        if (!VALID_PSR4_PREFIX.test(prefix)) {
            continue;
        }
        const rawDirs = Array.isArray(dirs) ? dirs : [dirs];
        const validDirs = rawDirs.filter(isValidDirectory);
        if (validDirs.length === 0) {
            continue;
        }
        mappings.push({
            prefix,
            directories: validDirs.map(normalizeDir),
            composerDir,
        });
    }

    return mappings;
}

/**
 * Parse composer.json content and return PSR-4 autoload mappings.
 */
export function parseComposerJson(content: string, composerDir: string): Psr4Mapping[] {
    let json: ComposerJson;
    try {
        json = JSON.parse(content) as ComposerJson;
    } catch (error) {
        console.warn('PHP Better Refactors: Failed to parse composer.json:', formatError(error));
        return [];
    }

    const mappings: Psr4Mapping[] = [];

    if (json.autoload?.['psr-4']) {
        mappings.push(...extractMappings(json.autoload['psr-4'], composerDir));
    }

    if (json['autoload-dev']?.['psr-4']) {
        mappings.push(...extractMappings(json['autoload-dev']['psr-4'], composerDir));
    }

    return mappings;
}
