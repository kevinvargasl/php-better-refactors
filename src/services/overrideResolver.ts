import { PhpFileInfo, MemberDeclaration, PhpLocation } from '../types';
import { LoadedPhpInfo } from './overrideInfoRepository';

export type OverrideSourceKind = 'class' | 'interface' | 'trait';

export interface OverrideTarget {
    kind: OverrideSourceKind;
    fqcn: string;
    filePath: string;
    methodName: string;
    loc: PhpLocation;
}

export interface OverrideBadge {
    member: MemberDeclaration;
    kinds: OverrideSourceKind[];
    label: string;
    targets: OverrideTarget[];
}

type LoadPhpInfo = (fqcn: string) => Promise<LoadedPhpInfo | null>;

interface ResolutionState {
    seen: Set<string>;
    methodTargets: Map<string, OverrideTarget[]>;
}

export async function resolveOverrideBadges(
    info: PhpFileInfo,
    loadPhpInfo: LoadPhpInfo,
): Promise<OverrideBadge[]> {
    const methods = info.members.filter(member => member.kind === 'method');
    if (!info.className || methods.length === 0) {
        return [];
    }

    const state: ResolutionState = {
        seen: new Set<string>(),
        methodTargets: new Map<string, OverrideTarget[]>(),
    };

    if (info.extendsFqcn) {
        await visitAncestor(info.extendsFqcn, 'class', loadPhpInfo, state);
    }
    for (const fqcn of info.implementsFqcns) {
        await visitAncestor(fqcn, 'interface', loadPhpInfo, state);
    }
    for (const fqcn of info.traitFqcns) {
        await visitAncestor(fqcn, 'trait', loadPhpInfo, state);
    }

    const badges: OverrideBadge[] = [];
    for (const member of methods) {
        const targets = state.methodTargets.get(member.name);
        if (!targets || targets.length === 0) {
            continue;
        }

        const kinds = new Set(targets.map(target => target.kind));
        const orderedKinds = ORDERED_KINDS.filter(kind => kinds.has(kind));
        badges.push({
            member,
            kinds: orderedKinds,
            label: orderedKinds.map(kind => LABELS[kind]).join(' '),
            targets,
        });
    }

    return badges;
}

const ORDERED_KINDS: OverrideSourceKind[] = ['class', 'interface', 'trait'];

const LABELS: Record<OverrideSourceKind, string> = {
    class: '@override',
    interface: '@implements',
    trait: '@trait',
};

async function visitAncestor(
    fqcn: string,
    sourceKind: OverrideSourceKind,
    loadPhpInfo: LoadPhpInfo,
    state: ResolutionState,
): Promise<void> {
    const seenKey = `${sourceKind}:${fqcn}`;
    if (state.seen.has(seenKey)) {
        return;
    }
    state.seen.add(seenKey);

    const ancestor = await loadPhpInfo(fqcn);
    const ancestorInfo = ancestor?.info;
    if (!ancestor || !ancestorInfo?.className) {
        return;
    }

    for (const member of ancestorInfo.members) {
        if (member.kind !== 'method') {
            continue;
        }

        let targets = state.methodTargets.get(member.name);
        if (!targets) {
            targets = [];
            state.methodTargets.set(member.name, targets);
        }
        if (!targets.some(target => target.fqcn === ancestor.fqcn && target.methodName === member.name)) {
            targets.push({
                kind: sourceKind,
                fqcn: ancestor.fqcn,
                filePath: ancestor.filePath,
                methodName: member.name,
                loc: member.loc,
            });
        }
    }

    if (ancestorInfo.extendsFqcn) {
        const nextKind = ancestorInfo.classType === 'interface' ? 'interface' : 'class';
        await visitAncestor(ancestorInfo.extendsFqcn, nextKind, loadPhpInfo, state);
    }
    for (const implementedFqcn of ancestorInfo.implementsFqcns) {
        await visitAncestor(implementedFqcn, 'interface', loadPhpInfo, state);
    }
    for (const traitFqcn of ancestorInfo.traitFqcns) {
        await visitAncestor(traitFqcn, 'trait', loadPhpInfo, state);
    }
}
