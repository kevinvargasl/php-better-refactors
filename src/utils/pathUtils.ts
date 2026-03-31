import * as path from 'path';

/**
 * Normalize a file path for consistent Map keys.
 * On Windows, lowercases the drive letter and uses forward slashes.
 */
export function normalizePath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    // Normalize Windows drive letter to lowercase (D:/code → d:/code)
    return normalized.length >= 2 && normalized[1] === ':'
        ? normalized[0].toLowerCase() + normalized.substring(1)
        : normalized;
}


function stripPhpExtension(filename: string): string {
    return filename.endsWith('.php') ? filename.slice(0, -4) : filename;
}

export function getBaseName(filePath: string): string {
    return stripPhpExtension(path.basename(filePath));
}

export function isPhpFile(filePath: string): boolean {
    return filePath.endsWith('.php');
}

/**
 * Convert a directory-relative path to a namespace segment.
 * e.g. "Models/User.php" → "Models\\User"
 */
export function pathToNamespaceSegment(relativePath: string): string {
    return stripPhpExtension(relativePath).replace(/\//g, '\\');
}

/**
 * Convert a namespace to a relative file path.
 * e.g. "Models\\User" → "Models/User.php"
 */
export function namespaceToRelativePath(namespace: string): string {
    if (!namespace) {
        return '';
    }
    return namespace.replace(/\\/g, '/') + '.php';
}
