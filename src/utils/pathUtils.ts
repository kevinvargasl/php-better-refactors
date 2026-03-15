import * as path from 'path';

/**
 * Normalize a file path for consistent Map keys.
 * On Windows, lowercases the drive letter and uses forward slashes.
 */
export function normalizePath(filePath: string): string {
    let normalized = filePath.replace(/\\/g, '/');
    // Normalize Windows drive letter to lowercase (D:/code → d:/code)
    if (normalized.length >= 2 && normalized[1] === ':') {
        normalized = normalized[0].toLowerCase() + normalized.substring(1);
    }
    return normalized;
}

/**
 * Get relative path from base to target, using forward slashes.
 */
export function relativePath(from: string, to: string): string {
    return path.relative(from, to).replace(/\\/g, '/');
}

/**
 * Check if a path is within a directory.
 */
export function isWithinDirectory(filePath: string, directory: string): boolean {
    const normalizedFile = normalizePath(path.resolve(filePath));
    const normalizedDir = normalizePath(path.resolve(directory));
    return normalizedFile.startsWith(normalizedDir + '/');
}

/**
 * Strip .php extension from a filename.
 */
export function stripPhpExtension(filename: string): string {
    if (filename.endsWith('.php')) {
        return filename.slice(0, -4);
    }
    return filename;
}

/**
 * Get the filename without extension from a full path.
 */
export function getBaseName(filePath: string): string {
    return stripPhpExtension(path.basename(filePath));
}

/**
 * Check if a file is a PHP file.
 */
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
