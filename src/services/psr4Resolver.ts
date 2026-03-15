import * as path from 'path';
import type { Psr4Mapping, Psr4Resolution } from '../types';
import {
    normalizePath,
    isWithinDirectory,
    relativePath,
    pathToNamespaceSegment,
    namespaceToRelativePath,
} from '../utils/pathUtils';
import { getNamespacePart } from '../utils/phpStringUtils';

export class Psr4Resolver {
    private mappings: Psr4Mapping[] = [];
    /** Precomputed prefixes with trailing backslash stripped */
    private trimmedPrefixes: Map<Psr4Mapping, string> = new Map();

    setMappings(mappings: Psr4Mapping[]): void {
        // Sort by prefix length descending so longest/most-specific prefix matches first
        this.mappings = [...mappings].sort(
            (a, b) => b.prefix.length - a.prefix.length
        );
        this.trimmedPrefixes.clear();
        for (const m of this.mappings) {
            this.trimmedPrefixes.set(m, m.prefix.replace(/\\$/, ''));
        }
    }

    private getTrimmedPrefix(mapping: Psr4Mapping): string {
        return this.trimmedPrefixes.get(mapping) || mapping.prefix.replace(/\\$/, '');
    }

    /**
     * Given a file path, compute the expected FQCN.
     * Returns null if the file is not under any PSR-4 mapping.
     */
    resolveNamespace(filePath: string): Psr4Resolution | null {
        const normalizedFile = normalizePath(path.resolve(filePath));

        let bestMatch: Psr4Resolution | null = null;

        for (const mapping of this.mappings) {
            for (const dir of mapping.directories) {
                const absoluteDir = normalizePath(
                    path.resolve(mapping.composerDir, dir)
                );

                if (!isWithinDirectory(normalizedFile, absoluteDir)) {
                    continue;
                }

                const relPath = relativePath(absoluteDir, normalizedFile);
                const namespaceSegment = pathToNamespaceSegment(relPath);

                const prefix = this.getTrimmedPrefix(mapping);
                const fqcn = namespaceSegment
                    ? `${prefix}\\${namespaceSegment}`
                    : prefix;

                // Because mappings are sorted by prefix length descending,
                // the first match is the most specific one.
                if (!bestMatch) {
                    bestMatch = { fqcn, mapping };
                }
            }

            if (bestMatch) {
                break;
            }
        }

        return bestMatch;
    }

    /**
     * Given a FQCN, compute the expected file path.
     * Returns null if the FQCN doesn't match any PSR-4 prefix.
     */
    resolveFilePath(fqcn: string): string | null {
        for (const mapping of this.mappings) {
            const prefix = this.getTrimmedPrefix(mapping);

            if (fqcn === prefix || fqcn.startsWith(prefix + '\\')) {
                const remainder = fqcn === prefix ? '' : fqcn.slice(prefix.length + 1);
                const relPath = namespaceToRelativePath(remainder);

                // Use the first directory of the mapping
                const dir = mapping.directories[0];
                const absolutePath = normalizePath(
                    path.resolve(mapping.composerDir, dir, relPath)
                );

                return absolutePath;
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
