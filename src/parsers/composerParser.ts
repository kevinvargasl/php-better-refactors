import type { Psr4Mapping } from '../types';

interface ComposerAutoload {
    'psr-4'?: Record<string, string | string[]>;
}

interface ComposerJson {
    autoload?: ComposerAutoload;
    'autoload-dev'?: ComposerAutoload;
}

/**
 * Normalize a directory path to always end with '/'.
 */
function normalizeDir(dir: string): string {
    if (dir === '') {
        return '/';
    }
    return dir.endsWith('/') ? dir : dir + '/';
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
        const directories = Array.isArray(dirs) ? dirs : [dirs];
        mappings.push({
            prefix,
            directories: directories.map(normalizeDir),
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
    } catch {
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
