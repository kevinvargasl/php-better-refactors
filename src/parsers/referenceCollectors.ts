import type { ClassReference, ReferenceType } from '../types';
import { extractNameString, nodeToLocation, resolveName, isBuiltInType, extractTypeReferences } from './parserUtils';

/** Context passed to each collector function */
export interface CollectorContext {
    node: any;
    useMap: Map<string, string>;
    currentNamespace: string | null;
    references: ClassReference[];
    /** Call to recurse into a child node */
    recurse: (child: any) => void;
}

/** Return true to skip default child recursion */
export type CollectorFn = (ctx: CollectorContext) => boolean;

/**
 * Try to add a reference from a name node. Returns true if a reference was added.
 */
function addRef(ctx: CollectorContext, nameNode: any, fallbackLocNode: any, type: ReferenceType): boolean {
    const nameInfo = extractNameString(nameNode);
    if (!nameInfo || !nameInfo.name || isBuiltInType(nameInfo.name)) {
        return false;
    }
    const resolved = resolveName(nameInfo.name, nameInfo.isFullyQualified, ctx.useMap, ctx.currentNamespace);
    ctx.references.push({
        name: nameInfo.name,
        resolvedFqcn: resolved,
        type,
        loc: nameNode?.loc ? nodeToLocation(nameNode) : nodeToLocation(fallbackLocNode),
    });
    return true;
}

/**
 * Add references for an array of name nodes (implements, catch, etc.)
 */
function addRefsFromArray(ctx: CollectorContext, nodes: any[], type: ReferenceType): void {
    for (const item of nodes) {
        addRef(ctx, item, ctx.node, type);
    }
}

function collectNew(ctx: CollectorContext): boolean {
    const what = ctx.node.what;
    if (what && what.kind !== 'variable') {
        addRef(ctx, what, ctx.node, 'new');
    }
    return false;
}

function collectClass(ctx: CollectorContext): boolean {
    if (ctx.node.extends) {
        addRef(ctx, ctx.node.extends, ctx.node, 'extends');
    }
    if (ctx.node.implements) {
        addRefsFromArray(ctx, ctx.node.implements, 'implements');
    }
    return false;
}

function collectInterface(ctx: CollectorContext): boolean {
    if (ctx.node.extends) {
        const exts = Array.isArray(ctx.node.extends) ? ctx.node.extends : [ctx.node.extends];
        addRefsFromArray(ctx, exts, 'extends');
    }
    return false;
}

function collectEnum(ctx: CollectorContext): boolean {
    if (ctx.node.implements) {
        addRefsFromArray(ctx, ctx.node.implements, 'implements');
    }
    return false;
}

function collectTraitUse(ctx: CollectorContext): boolean {
    if (ctx.node.traits) {
        addRefsFromArray(ctx, ctx.node.traits, 'type_hint');
    }
    return false;
}

function collectStaticLookup(ctx: CollectorContext): boolean {
    const what = ctx.node.what;
    if (what && what.kind !== 'variable') {
        const offset = ctx.node.offset;
        const isClassConst =
            (typeof offset === 'string' && offset === 'class') ||
            (offset && typeof offset === 'object' && offset.name === 'class');
        addRef(ctx, what, ctx.node, isClassConst ? 'class_constant' : 'static_call');
    }
    // Manually recurse into specific children only
    ctx.recurse(ctx.node.offset);
    if (ctx.node.what?.kind === 'variable') {
        ctx.recurse(ctx.node.what);
    }
    return true; // skip default recursion
}

function collectCatch(ctx: CollectorContext): boolean {
    if (ctx.node.what) {
        addRefsFromArray(ctx, ctx.node.what, 'catch');
    }
    return false;
}

function collectInstanceofRight(ctx: CollectorContext): boolean {
    // Handles both kind:'instanceof' and kind:'bin' with type:'instanceof'
    if (ctx.node.kind === 'bin' && ctx.node.type !== 'instanceof') {
        return false;
    }
    const right = ctx.node.right;
    if (right && right.kind !== 'variable') {
        addRef(ctx, right, ctx.node, 'instanceof');
    }
    return false;
}

function collectFunctionLike(ctx: CollectorContext): boolean {
    if (ctx.node.type) {
        extractTypeReferences(ctx.node.type, 'return_type', ctx.useMap, ctx.currentNamespace, ctx.references);
    }
    // Parameter types are handled by collectParameter via child recursion — don't extract here
    return false;
}

function collectParameter(ctx: CollectorContext): boolean {
    if (ctx.node.type) {
        extractTypeReferences(ctx.node.type, 'param_type', ctx.useMap, ctx.currentNamespace, ctx.references);
    }
    return false;
}

function collectProperty(ctx: CollectorContext): boolean {
    if (ctx.node.type) {
        extractTypeReferences(ctx.node.type, 'property_type', ctx.useMap, ctx.currentNamespace, ctx.references);
    }
    return false;
}

function collectAttribute(ctx: CollectorContext): boolean {
    if (ctx.node.name) {
        addRef(ctx, ctx.node.name, ctx.node, 'attribute');
    }
    return false;
}

function collectAttrGroup(ctx: CollectorContext): boolean {
    if (ctx.node.attrs) {
        for (const attr of ctx.node.attrs) {
            ctx.recurse(attr);
        }
    }
    return true; // skip default recursion
}

export const collectors: Record<string, CollectorFn> = {
    'new': collectNew,
    'class': collectClass,
    'interface': collectInterface,
    'enum': collectEnum,
    'traituse': collectTraitUse,
    'staticlookup': collectStaticLookup,
    'catch': collectCatch,
    'instanceof': collectInstanceofRight,
    'bin': collectInstanceofRight,
    'function': collectFunctionLike,
    'method': collectFunctionLike,
    'closure': collectFunctionLike,
    'arrowfunc': collectFunctionLike,
    'parameter': collectParameter,
    'property': collectProperty,
    'propertystatement': collectProperty,
    'attribute': collectAttribute,
    'attrgroup': collectAttrGroup,
};
