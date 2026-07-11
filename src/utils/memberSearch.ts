import * as vscode from 'vscode';
import { parsePhpAst } from '../parsers/phpParser';
import {
    buildUseMap,
    extractNameString,
    forEachChild,
    resolveName,
} from '../parsers/parserUtils';
import { MemberDeclaration, UseStatement } from '../types';

type MemberKind = MemberDeclaration['kind'];

const PHP_IDENTIFIER = /^[a-zA-Z_\x80-\xff][a-zA-Z0-9_\x80-\xff]*$/;

export interface MemberSearchContext {
    namespace: string | null;
    useStatements: UseStatement[];
    declaredFqcn: string | null;
    parentFqcn: string | null;
}

export function hasPotentialMemberReferenceText(
    text: string,
    memberName: string,
    memberKind: MemberKind,
): boolean {
    if (!PHP_IDENTIFIER.test(memberName)) {
        return false;
    }

    if (memberKind === 'property') {
        return text.includes('->' + memberName) || text.includes('::$' + memberName);
    }

    if (memberKind === 'constant') {
        return text.includes('::' + memberName);
    }

    return text.includes('->' + memberName) || text.includes('::' + memberName);
}

export function findMemberReferences(
    document: vscode.TextDocument,
    memberName: string,
    memberKind: MemberKind,
    targetFqcn: string,
    context: MemberSearchContext,
): vscode.Range[] {
    return findMemberReferenceOffsets(
        document.getText(),
        memberName,
        memberKind,
        targetFqcn,
        context,
    ).map(({ start, end }) =>
        new vscode.Range(document.positionAt(start), document.positionAt(end))
    );
}

/** Find provably typed member references without creating a TextDocument. */
export function findMemberReferencesInText(
    text: string,
    memberName: string,
    memberKind: MemberKind,
    targetFqcn: string,
    context: MemberSearchContext,
): vscode.Range[] {
    const offsets = findMemberReferenceOffsets(text, memberName, memberKind, targetFqcn, context);
    if (offsets.length === 0) {
        return [];
    }

    const lineStarts = buildLineStarts(text);
    return offsets.map(({ start, end }) => new vscode.Range(
        positionAt(start, lineStarts),
        positionAt(end, lineStarts),
    ));
}

function findMemberReferenceOffsets(
    text: string,
    memberName: string,
    memberKind: MemberKind,
    targetFqcn: string,
    context: MemberSearchContext,
): Array<{ start: number; end: number }> {
    if (!PHP_IDENTIFIER.test(memberName)
        || !hasPotentialMemberReferenceText(text, memberName, memberKind)) {
        return [];
    }

    const ast = parsePhpAst(text);
    if (!ast) {
        return [];
    }

    const useMap = buildUseMap(context.useStatements);
    const propertyTypes = collectDeclaredPropertyTypes(
        ast,
        useMap,
        context.namespace,
        context.declaredFqcn,
    );
    const matches: Array<{ start: number; end: number }> = [];
    const seenOffsets = new Set<number>();

    const addMatch = (node: any, skipLeadingDollar = false): void => {
        const rawStart = node?.loc?.start?.offset;
        const end = node?.loc?.end?.offset;
        const start = typeof rawStart === 'number' && skipLeadingDollar ? rawStart + 1 : rawStart;
        if (typeof start === 'number' && typeof end === 'number' && !seenOffsets.has(start)) {
            seenOffsets.add(start);
            matches.push({ start, end });
        }
    };

    const visit = (
        node: any,
        variableTypes: Map<string, string>,
        parent: any = null,
        currentClassFqcn: string | null = null,
    ): void => {
        if (!node || typeof node !== 'object') {
            return;
        }
        if (Array.isArray(node)) {
            for (const child of node) {
                visit(child, variableTypes, parent, currentClassFqcn);
            }
            return;
        }

        if (isClassLike(node)) {
            const className = node.isAnonymous ? undefined : identifierName(node.name);
            const classFqcn = className ? qualifyName(context.namespace, className) : null;
            visit(node.body, new Map<string, string>(), node, classFqcn);
            return;
        }

        if (isFunctionLike(node)) {
            const scopedTypes = new Map<string, string>();
            for (const parameter of node.arguments || []) {
                const variableName = identifierName(parameter.name);
                const fqcn = resolveSingleType(parameter.type, useMap, context.namespace);
                if (variableName && fqcn) {
                    scopedTypes.set(variableName, fqcn);
                }
            }
            visit(node.body, scopedTypes, node, currentClassFqcn);
            return;
        }

        if (isBranchingNode(node)) {
            forEachChild(node, child => visit(
                child,
                new Map(variableTypes),
                node,
                currentClassFqcn,
            ));
            variableTypes.clear();
            return;
        }

        if (node.kind === 'assign' && node.operator === '=' && node.left?.kind === 'variable') {
            const variableName = identifierName(node.left);
            if (variableName) {
                const assignedType = resolveExpressionType(
                    node.right,
                    variableTypes,
                    propertyTypes,
                    useMap,
                    context,
                    currentClassFqcn,
                );
                if (assignedType) {
                    variableTypes.set(variableName, assignedType);
                } else {
                    variableTypes.delete(variableName);
                }
            }
        }

        if (node.kind === 'staticlookup') {
            const isCall = parent?.kind === 'call' && parent.what === node;
            const offsetIsVariable = node.offset?.kind === 'variable';
            const matchesKind = memberKind === 'method'
                ? isCall && !offsetIsVariable
                : memberKind === 'property'
                    ? !isCall && offsetIsVariable
                    : !isCall && !offsetIsVariable;
            if (matchesKind
                && identifierName(node.offset) === memberName
                && resolveStaticReceiver(node.what, useMap, context, currentClassFqcn) === targetFqcn) {
                addMatch(node.offset, memberKind === 'property');
            }
        }

        if (memberKind !== 'constant'
            && (node.kind === 'propertylookup' || node.kind === 'nullsafepropertylookup')) {
            const isCall = parent?.kind === 'call' && parent.what === node;
            if (isCall === (memberKind === 'method')
                && identifierName(node.offset) === memberName
                && resolveExpressionType(
                    node.what,
                    variableTypes,
                    propertyTypes,
                    useMap,
                    context,
                    currentClassFqcn,
                ) === targetFqcn) {
                addMatch(node.offset);
            }
        }

        forEachChild(node, child => visit(child, variableTypes, node, currentClassFqcn));
    };

    visit(ast, new Map<string, string>());
    return matches;
}

function collectDeclaredPropertyTypes(
    ast: any,
    useMap: Map<string, string>,
    currentNamespace: string | null,
    declaredFqcn: string | null,
): Map<string, string> {
    const types = new Map<string, string>();
    const visit = (node: any): void => {
        if (!node || typeof node !== 'object') {
            return;
        }
        if (Array.isArray(node)) {
            node.forEach(visit);
            return;
        }
        if (isClassLike(node)) {
            const className = node.isAnonymous ? undefined : identifierName(node.name);
            if (!className || qualifyName(currentNamespace, className) !== declaredFqcn) {
                return;
            }
        }
        if (node.kind === 'property') {
            const name = identifierName(node.name);
            const fqcn = resolveSingleType(node.type, useMap, currentNamespace);
            if (name && fqcn) {
                types.set(name, fqcn);
            }
        }
        forEachChild(node, visit);
    };
    visit(ast);
    return types;
}

function resolveExpressionType(
    node: any,
    variableTypes: Map<string, string>,
    propertyTypes: Map<string, string>,
    useMap: Map<string, string>,
    context: MemberSearchContext,
    currentClassFqcn: string | null,
): string | undefined {
    if (!node || typeof node !== 'object') {
        return undefined;
    }

    if (node.kind === 'variable') {
        const name = identifierName(node);
        if (name === 'this') {
            return currentClassFqcn ?? undefined;
        }
        return name ? variableTypes.get(name) : undefined;
    }

    if (node.kind === 'new') {
        return resolveClassName(node.what, useMap, context.namespace);
    }

    if ((node.kind === 'propertylookup' || node.kind === 'nullsafepropertylookup')
        && resolveExpressionType(
            node.what,
            variableTypes,
            propertyTypes,
            useMap,
            context,
            currentClassFqcn,
        ) === currentClassFqcn) {
        const propertyName = identifierName(node.offset);
        return propertyName ? propertyTypes.get(propertyName) : undefined;
    }

    return undefined;
}

function resolveStaticReceiver(
    node: any,
    useMap: Map<string, string>,
    context: MemberSearchContext,
    currentClassFqcn: string | null,
): string | undefined {
    if (node?.kind === 'selfreference' || node?.kind === 'staticreference') {
        return currentClassFqcn ?? undefined;
    }
    if (node?.kind === 'parentreference') {
        return context.parentFqcn ?? undefined;
    }

    const nameInfo = extractNameString(node);
    if (!nameInfo) {
        return undefined;
    }
    const lowerName = nameInfo.name.toLowerCase();
    if (lowerName === 'self' || lowerName === 'static') {
        return currentClassFqcn ?? undefined;
    }
    return resolveName(nameInfo.name, nameInfo.isFullyQualified, useMap, context.namespace);
}

function resolveClassName(
    node: any,
    useMap: Map<string, string>,
    currentNamespace: string | null,
): string | undefined {
    const nameInfo = extractNameString(node);
    return nameInfo
        ? resolveName(nameInfo.name, nameInfo.isFullyQualified, useMap, currentNamespace)
        : undefined;
}

function resolveSingleType(
    node: any,
    useMap: Map<string, string>,
    currentNamespace: string | null,
): string | undefined {
    if (!node) {
        return undefined;
    }
    if (node.kind === 'nullable') {
        return resolveSingleType(node.type, useMap, currentNamespace);
    }
    if (node.kind === 'uniontype' || node.kind === 'intersectiontype') {
        return undefined;
    }
    return resolveClassName(node, useMap, currentNamespace);
}

function isFunctionLike(node: any): boolean {
    return node.kind === 'method'
        || node.kind === 'function'
        || node.kind === 'closure'
        || node.kind === 'arrowfunc';
}

function isClassLike(node: any): boolean {
    return node.kind === 'class'
        || node.kind === 'interface'
        || node.kind === 'trait'
        || node.kind === 'enum';
}

function isBranchingNode(node: any): boolean {
    return node.kind === 'if'
        || node.kind === 'switch'
        || node.kind === 'while'
        || node.kind === 'do'
        || node.kind === 'for'
        || node.kind === 'foreach'
        || node.kind === 'try';
}

function qualifyName(currentNamespace: string | null, name: string): string {
    return currentNamespace ? `${currentNamespace}\\${name}` : name;
}

function identifierName(node: any): string | undefined {
    if (typeof node === 'string') {
        return node;
    }
    return typeof node?.name === 'string' ? node.name : undefined;
}

function buildLineStarts(text: string): number[] {
    const starts = [0];
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) === 10) {
            starts.push(i + 1);
        }
    }
    return starts;
}

function positionAt(offset: number, lineStarts: number[]): vscode.Position {
    let low = 0;
    let high = lineStarts.length;
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (lineStarts[mid] > offset) {
            high = mid;
        } else {
            low = mid + 1;
        }
    }

    const line = Math.max(0, low - 1);
    return new vscode.Position(line, offset - lineStarts[line]);
}
