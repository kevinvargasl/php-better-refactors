import type {
    PhpFileInfo,
    PhpLocation,
    UseStatement,
    ClassReference,
    MemberDeclaration,
} from '../types';
import { stripLeadingBackslash, getShortName } from '../utils/phpStringUtils';
import { nodeToLocation, forEachChild, buildUseMap } from './parserUtils';
import { collectors } from './referenceCollectors';

const Engine = require('php-parser');

const engine = new Engine({
    parser: { extractDoc: false, php7: true, suppressErrors: true },
    ast: { withPositions: true, withSource: false },
    lexer: { all_tokens: false, short_tags: false },
});

interface Declarations {
    namespace: string | null;
    namespaceLoc: PhpLocation | null;
    className: string | null;
    classType: 'class' | 'interface' | 'trait' | 'enum' | null;
    classLoc: PhpLocation | null;
    useStatements: UseStatement[];
    members: MemberDeclaration[];
}

function extractDeclarations(ast: any): Declarations {
    const result: Declarations = {
        namespace: null,
        namespaceLoc: null,
        className: null,
        classType: null,
        classLoc: null,
        useStatements: [],
        members: [],
    };

    // Declarations only appear at the top level of the AST — no deep walk needed.
    const topLevel = ast.children || [];
    for (const node of topLevel) {
        if (!node || typeof node !== 'object') { continue; }
        processDeclarationNode(node, result);
        // Namespace nodes contain their children inline
        if (node.kind === 'namespace' && node.children) {
            for (const child of node.children) {
                if (child && typeof child === 'object') {
                    processDeclarationNode(child, result);
                }
            }
        }
    }

    return result;
}

function processDeclarationNode(node: any, result: Declarations): void {
    switch (node.kind) {
        case 'namespace': {
            const nsName = extractNamespaceName(node.name);
            if (nsName) {
                result.namespace = nsName;
                if (node.loc) {
                    const stmtLen = 'namespace '.length + nsName.length + 1;
                    result.namespaceLoc = {
                        startLine: node.loc.start.line,
                        startColumn: node.loc.start.column,
                        endLine: node.loc.start.line,
                        endColumn: node.loc.start.column + stmtLen,
                        startOffset: node.loc.start.offset,
                        endOffset: node.loc.start.offset + stmtLen,
                    };
                }
            }
            break;
        }

        case 'usegroup':
            result.useStatements.push(...extractUseStatements(node));
            break;

        case 'class':
        case 'interface':
        case 'trait':
        case 'enum': {
            const name = node.name;
            const nameStr = typeof name === 'string' ? name : name?.name;
            if (nameStr && !result.className) {
                result.className = nameStr;
                result.classType = node.kind as Declarations['classType'];
                const nameNode = typeof name === 'object' && name?.loc ? name : node;
                result.classLoc = nameNode.loc ? nodeToLocation(nameNode) : null;
            }
            extractMembers(node.body, result.members);
            break;
        }
    }
}

function collectReferences(
    node: any,
    useMap: Map<string, string>,
    currentNamespace: string | null,
    references: ClassReference[],
): void {
    if (!node || typeof node !== 'object') {
        return;
    }
    if (Array.isArray(node)) {
        for (const child of node) {
            collectReferences(child, useMap, currentNamespace, references);
        }
        return;
    }

    const collector = collectors[node.kind];
    if (collector) {
        const skipChildren = collector({
            node,
            useMap,
            currentNamespace,
            references,
            recurse: (child: any) => collectReferences(child, useMap, currentNamespace, references),
        });
        if (skipChildren) {
            return;
        }
    }

    forEachChild(node, child => collectReferences(child, useMap, currentNamespace, references));
}

function extractMembers(body: any[], members: MemberDeclaration[]): void {
    if (!body) {
        return;
    }
    for (const member of body) {
        if (member.kind === 'method') {
            const nameNode = member.name;
            const name = typeof nameNode === 'string' ? nameNode : nameNode?.name;
            if (name && nameNode?.loc) {
                members.push({name, kind: 'method', isStatic: !!member.isStatic, loc: nodeToLocation(nameNode)});
            }
            // Constructor property promotion (PHP 8.0+)
            // Promoted params have flags > 0 (1=public, 2=protected, 4=private)
            if (name === '__construct' && member.arguments) {
                for (const arg of member.arguments) {
                    if (arg.kind === 'parameter' && arg.flags > 0) {
                        const paramNameNode = arg.name;
                        const paramName = typeof paramNameNode === 'string' ? paramNameNode : paramNameNode?.name;
                        if (paramName && paramNameNode?.loc) {
                            members.push({name: paramName, kind: 'property', isStatic: false, loc: nodeToLocation(paramNameNode)});
                        }
                    }
                }
            }
        } else if (member.kind === 'propertystatement') {
            for (const prop of member.properties || []) {
                const nameNode = prop.name;
                const name = typeof nameNode === 'string' ? nameNode : nameNode?.name;
                if (name && nameNode?.loc) {
                    members.push({name, kind: 'property', isStatic: !!member.isStatic, loc: nodeToLocation(nameNode)});
                }
            }
        }
    }
}

function extractNamespaceName(node: any): string | null {
    if (!node) {
        return null;
    }
    if (typeof node === 'string') {
        return node || null;
    }
    if (typeof node.name === 'string') {
        return node.name || null;
    }
    return null;
}

function extractUseStatements(node: any): UseStatement[] {
    if (node.kind !== 'usegroup') {
        return [];
    }

    const results: UseStatement[] = [];
    const groupPrefix = typeof node.name === 'string' ? node.name : node.name?.name ?? '';

    for (const item of node.items || []) {
        if (item.kind !== 'useitem') {
            continue;
        }

        const itemName = typeof item.name === 'string' ? item.name : (item.name?.name || '');
        let fullName = groupPrefix ? `${groupPrefix}\\${itemName}` : itemName;
        fullName = stripLeadingBackslash(fullName);

        const alias: string | null = item.alias?.name || item.alias || null;
        const computedShortName = getShortName(fullName);
        const shortName = alias || computedShortName;
        const loc = item.loc ? nodeToLocation(item) : nodeToLocation(node);

        const useStmt: UseStatement = {
            fqcn: fullName,
            alias: alias && alias !== computedShortName ? alias : null,
            shortName,
            loc,
        };

        if (groupPrefix) {
            useStmt.groupPrefix = groupPrefix;
        }

        results.push(useStmt);
    }

    return results;
}

const EMPTY_RESULT: PhpFileInfo = Object.freeze({
    namespace: null,
    namespaceLoc: null,
    className: null,
    classType: null,
    classLoc: null,
    useStatements: Object.freeze([]) as readonly never[] as never[],
    references: Object.freeze([]) as readonly never[] as never[],
    members: Object.freeze([]) as readonly never[] as never[],
});

export function parsePhpFile(content: string): PhpFileInfo {
    let ast: any;
    try {
        ast = engine.parseCode(content, 'file.php');
    } catch {
        return EMPTY_RESULT;
    }

    const decl = extractDeclarations(ast);

    const references: ClassReference[] = [];
    const useMap = buildUseMap(decl.useStatements);
    collectReferences(ast, useMap, decl.namespace, references);

    return { ...decl, references };
}
