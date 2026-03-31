export function isValidClassName(name: string): boolean {
    return /^[a-zA-Z_\x80-\xff][a-zA-Z0-9_\x80-\xff]*$/.test(name);
}

/**
 * Get the short name (last segment) from a FQCN.
 * e.g. "App\\Models\\User" → "User"
 */
export function getShortName(fqcn: string): string {
    const last = fqcn.lastIndexOf('\\');
    return last === -1 ? fqcn : fqcn.substring(last + 1);
}

/**
 * Get the namespace portion of a FQCN (everything except the last segment).
 * e.g. "App\\Models\\User" → "App\\Models"
 * e.g. "User" → ""
 */
export function getNamespacePart(fqcn: string): string {
    const lastBackslash = fqcn.lastIndexOf('\\');
    if (lastBackslash === -1) {
        return '';
    }
    return fqcn.substring(0, lastBackslash);
}

/**
 * Build a FQCN from namespace and class name.
 */
export function buildFqcn(namespace: string | null, className: string): string {
    if (!namespace) {
        return className;
    }
    return `${namespace}\\${className}`;
}

/**
 * Strip leading backslash from a FQCN.
 */
export function stripLeadingBackslash(fqcn: string): string {
    return fqcn.startsWith('\\') ? fqcn.substring(1) : fqcn;
}
