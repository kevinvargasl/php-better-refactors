import { Minimatch } from 'minimatch';

const MATCH_OPTIONS = {
    dot: true,
    nocase: process.platform === 'win32',
    nocomment: true,
    nonegate: true,
};

export function buildExcludeMatchers(patterns: string[]): Minimatch[] {
    return patterns
        .filter(pattern => pattern.length > 0)
        .map(pattern => new Minimatch(pattern.replace(/\\/g, '/'), MATCH_OPTIONS));
}

export function matchesExcludePatterns(relPath: string, matchers: Minimatch[]): boolean {
    const normalizedPath = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
    return matchers.some(matcher => matcher.match(normalizedPath));
}
