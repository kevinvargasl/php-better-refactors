import type {
    PhpLocation,
    UseStatement,
    ClassReference,
    ReferenceType,
} from '../types';
import { stripLeadingBackslash } from '../utils/phpStringUtils';

const BUILT_IN_TYPES = new Set([
    'string', 'int', 'float', 'bool', 'array', 'object', 'mixed',
    'void', 'null', 'never', 'self', 'static', 'parent', 'callable',
    'iterable', 'false', 'true',
]);

const EMPTY_LOCATION: PhpLocation = { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0, startOffset: 0, endOffset: 0 };

export function nodeToLocation(node: any): PhpLocation {
    const loc = node.loc;
    return {
        startLine: loc.start.line,
        startColumn: loc.start.column,
        endLine: loc.end.line,
        endColumn: loc.end.column,
        startOffset: loc.start.offset,
        endOffset: loc.end.offset,
    };
}

/**
 * Extract the string name from a php-parser name node.
 */
export function extractNameString(node: any): { name: string; isFullyQualified: boolean } | null {
    if (!node) {
        return null;
    }

    if (typeof node === 'string') {
        return { name: node, isFullyQualified: false };
    }

    if (typeof node.name === 'string') {
        const isFullyQualified = node.kind === 'fullname' ||
            (typeof node.resolution === 'string' && node.resolution === 'fqn');
        return { name: node.name, isFullyQualified };
    }

    return null;
}

/**
 * Resolve a class name to its FQCN using a use-statement map and current namespace.
 */
export function resolveName(
    name: string,
    isFullyQualified: boolean,
    useMap: Map<string, string>,
    currentNamespace: string | null,
): string {
    if (isFullyQualified || name.startsWith('\\')) {
        return stripLeadingBackslash(name);
    }

    const bsPos = name.indexOf('\\');
    const firstSegment = bsPos === -1 ? name : name.substring(0, bsPos);
    const rest = bsPos === -1 ? '' : name.substring(bsPos);

    const matchedFqcn = useMap.get(firstSegment);
    if (matchedFqcn !== undefined) {
        return matchedFqcn + rest;
    }

    if (currentNamespace) {
        return `${currentNamespace}\\${name}`;
    }

    return name;
}

/**
 * Build a Map from short name to FQCN for O(1) use-statement lookup.
 */
export function buildUseMap(useStatements: UseStatement[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const use of useStatements) {
        map.set(use.shortName, use.fqcn);
    }
    return map;
}

export function isBuiltInType(name: string): boolean {
    return BUILT_IN_TYPES.has(name.toLowerCase());
}

/**
 * Extract type references from a type node (handles nullable, union, intersection types).
 */
export function extractTypeReferences(
    typeNode: any,
    refType: ReferenceType,
    useMap: Map<string, string>,
    currentNamespace: string | null,
    references: ClassReference[],
): void {
    if (!typeNode) {
        return;
    }

    if (typeNode.kind === 'nullable') {
        extractTypeReferences(typeNode.type, refType, useMap, currentNamespace, references);
        return;
    }

    if (typeNode.kind === 'uniontype' || typeNode.kind === 'intersectiontype') {
        for (const t of typeNode.types || []) {
            extractTypeReferences(t, refType, useMap, currentNamespace, references);
        }
        return;
    }

    const nameInfo = extractNameString(typeNode);
    if (nameInfo && !isBuiltInType(nameInfo.name)) {
        const resolved = resolveName(nameInfo.name, nameInfo.isFullyQualified, useMap, currentNamespace);
        references.push({
            name: nameInfo.name,
            resolvedFqcn: resolved,
            type: refType,
            loc: typeNode.loc ? nodeToLocation(typeNode) : EMPTY_LOCATION,
        });
    }
}

const SKIP_KEYS = new Set(['loc', 'kind', 'leadingComments', 'trailingComments']);

/**
 * Iterate over all AST child nodes of a node, calling the visitor for each.
 */
export function forEachChild(node: any, visitor: (child: any) => void): void {
    for (const key of Object.keys(node)) {
        if (SKIP_KEYS.has(key)) {
            continue;
        }
        const child = node[key];
        if (child && typeof child === 'object') {
            if (Array.isArray(child)) {
                for (const item of child) {
                    if (item && typeof item === 'object' && item.kind) {
                        visitor(item);
                    }
                }
            } else if (child.kind) {
                visitor(child);
            }
        }
    }
}
