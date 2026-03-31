export function buildExcludeSegments(patterns: string[]): string[] {
    const segments: string[] = [];
    for (const pattern of patterns) {
        const segment = pattern.replace(/\*\*/g, '').replace(/\*/g, '').replace(/\\/g, '/');
        if (segment.length > 0 && segment !== '/') {
            segments.push(segment);
        }
    }
    return segments;
}

export function matchesExcludeSegments(relPath: string, segments: string[]): boolean {
    const prefixed = '/' + relPath;
    return segments.some(seg => prefixed.includes(seg));
}
