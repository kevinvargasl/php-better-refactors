import type {
    PhpFileInfo,
    PhpLocation,
    UseStatement,
    ClassReference,
    MemberDeclaration,
} from '../types';
import { stripLeadingBackslash, getShortName } from '../utils/phpStringUtils';
import { nodeToLocation, forEachChild } from './parserUtils';
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

    function walk(node: any): void {
        if (!node || typeof node !== 'object') {
            return;
        }
        if (Array.isArray(node)) {
            for (const child of node) {
                walk(child);
            }
            return;
        }

        switch (node.kind) {
            case 'namespace': {
                const nsName = extractNamespaceName(node.name);
                if (nsName) {
                    result.namespace = nsName;
                    // Narrow the loc to just the "namespace X;" declaration,
                    // not the entire block (which includes all children).
                    if (node.loc) {
                        const stmtLen = 'namespace '.length + nsName.length + 1; // +1 for ";"
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
                if (node.children) {
                    walk(node.children);
                }
                return;
            }

            case 'usegroup':
                result.useStatements.push(...extractUseStatements(node));
                return;

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

            default:
                break;
        }

        forEachChild(node, walk);
    }

    walk(ast);
    return result;
}

function collectReferences(
    node: any,
    useStatements: UseStatement[],
    currentNamespace: string | null,
    references: ClassReference[],
): void {
    if (!node || typeof node !== 'object') {
        return;
    }
    if (Array.isArray(node)) {
        for (const child of node) {
            collectReferences(child, useStatements, currentNamespace, references);
        }
        return;
    }

    const collector = collectors[node.kind];
    if (collector) {
        const skipChildren = collector({
            node,
            useStatements,
            currentNamespace,
            references,
            recurse: (child: any) => collectReferences(child, useStatements, currentNamespace, references),
        });
        if (skipChildren) {
            return;
        }
    }

    forEachChild(node, child => collectReferences(child, useStatements, currentNamespace, references));
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
                members.push({
                    name,
                    kind: 'method',
                    isStatic: !!member.isStatic,
                    loc: nodeToLocation(nameNode),
                });
            }
        } else if (member.kind === 'propertystatement') {
            for (const prop of member.properties || []) {
                const nameNode = prop.name;
                const name = typeof nameNode === 'string' ? nameNode : nameNode?.name;
                if (name && nameNode?.loc) {
                    members.push({
                        name,
                        kind: 'property',
                        isStatic: !!member.isStatic,
                        loc: nodeToLocation(nameNode),
                    });
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
    const groupPrefix = node.name
        ? (typeof node.name === 'string' ? node.name : (node.name?.name || ''))
        : '';

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

const EMPTY_RESULT: PhpFileInfo = {
    namespace: null,
    namespaceLoc: null,
    className: null,
    classType: null,
    classLoc: null,
    useStatements: [],
    references: [],
    members: [],
};

export function parsePhpFile(content: string): PhpFileInfo {
    let ast: any;
    try {
        ast = engine.parseCode(content, 'file.php');
    } catch {
        return { ...EMPTY_RESULT };
    }

    const decl = extractDeclarations(ast);

    const references: ClassReference[] = [];
    collectReferences(ast, decl.useStatements, decl.namespace, references);

    return { ...decl, references };
}
