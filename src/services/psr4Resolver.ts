import * as path from 'path';
import type { Psr4Mapping, Psr4Resolution } from '../types';
import {
    normalizePath,
    pathToNamespaceSegment,
    namespaceToRelativePath,
} from '../utils/pathUtils';
import { getNamespacePart } from '../utils/phpStringUtils';

interface ResolvedDir {
    absoluteDir: string;
    /** Pre-computed absoluteDir + '/' for startsWith checks */
    absoluteDirSlash: string;
}

interface ResolvedMapping {
    mapping: Psr4Mapping;
    trimmedPrefix: string;
    dirs: ResolvedDir[];
    /** Pre-computed first directory absolute path for resolveFilePath */
    firstDirAbsolute: string;
}

export class Psr4Resolver {
    private resolved: ResolvedMapping[] = [];

    setMappings(mappings: Psr4Mapping[]): void {
        // Sort by prefix length descending so longest/most-specific prefix matches first
        const sorted = [...mappings].sort(
            (a, b) => b.prefix.length - a.prefix.length
        );

        this.resolved = sorted.map(mapping => {
            const composerBase = normalizePath(path.resolve(mapping.composerDir));
            const composerBaseSlash = composerBase + '/';
            const trimmedPrefix = mapping.prefix.replace(/\\$/, '');

            const dirs: ResolvedDir[] = [];
            for (const dir of mapping.directories) {
                const absoluteDir = normalizePath(path.resolve(mapping.composerDir, dir));
                // Reject directories that escape the composer.json base
                if (absoluteDir.startsWith(composerBaseSlash) || absoluteDir === composerBase) {
                    dirs.push({ absoluteDir, absoluteDirSlash: absoluteDir + '/' });
                }
            }

            const firstDirAbsolute = dirs.length > 0
                ? dirs[0].absoluteDir
                : composerBase;

            return { mapping, trimmedPrefix, dirs, firstDirAbsolute };
        });
    }

    /**
     * Given a file path, compute the expected FQCN.
     * Returns null if the file is not under any PSR-4 mapping.
     */
    resolveNamespace(filePath: string): Psr4Resolution | null {
        const normalizedFile = normalizePath(path.resolve(filePath));

        for (const resolved of this.resolved) {
            for (const dir of resolved.dirs) {
                if (!normalizedFile.startsWith(dir.absoluteDirSlash)) {
                    continue;
                }

                const relPath = normalizedFile.substring(dir.absoluteDirSlash.length);
                const namespaceSegment = pathToNamespaceSegment(relPath);

                const fqcn = namespaceSegment
                    ? `${resolved.trimmedPrefix}\\${namespaceSegment}`
                    : resolved.trimmedPrefix;

                // Mappings are sorted by prefix length descending,
                // so the first match is the most specific one.
                return { fqcn, mapping: resolved.mapping };
            }
        }

        return null;
    }

    /**
     * Given a FQCN, compute the expected file path.
     * Returns null if the FQCN doesn't match any PSR-4 prefix.
     */
    resolveFilePath(fqcn: string): string | null {
        for (const resolved of this.resolved) {
            if (fqcn === resolved.trimmedPrefix || fqcn.startsWith(resolved.trimmedPrefix + '\\')) {
                const remainder = fqcn === resolved.trimmedPrefix ? '' : fqcn.slice(resolved.trimmedPrefix.length + 1);
                const relPath = namespaceToRelativePath(remainder);
                return normalizePath(path.resolve(resolved.firstDirAbsolute, relPath));
            }
        }

        return null;
    }

    /**
     * Get just the namespace for a file (without the class name segment).
     * Returns null if the file is not under any PSR-4 mapping.
     */
    resolveNamespaceForFile(filePath: string): string | null {
        const resolution = this.resolveNamespace(filePath);
        if (!resolution) {
            return null;
        }
        return getNamespacePart(resolution.fqcn);
    }
}
