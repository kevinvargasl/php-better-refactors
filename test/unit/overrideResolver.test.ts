import * as assert from 'assert';
import { resolveOverrideBadges } from '../../src/services/overrideResolver';
import { PhpFileInfo } from '../../src/types';

describe('overrideResolver', () => {
    it('marks methods inherited from parents, interfaces, and traits', async () => {
        const infoMap = new Map<string, PhpFileInfo>([
            ['App\\BaseModel', makeInfo({
                className: 'BaseModel',
                classType: 'class',
                members: ['save', 'boot'],
                implementsFqcns: ['App\\Contracts\\SavesModel'],
            })],
            ['App\\Contracts\\SavesModel', makeInfo({
                className: 'SavesModel',
                classType: 'interface',
                members: ['save'],
            })],
            ['App\\Traits\\Bootable', makeInfo({
                className: 'Bootable',
                classType: 'trait',
                members: ['boot'],
            })],
        ]);
        infoMap.get('App\\BaseModel')!.traitFqcns = ['App\\Traits\\Bootable'];

        const current = makeInfo({
            className: 'User',
            classType: 'class',
            extendsFqcn: 'App\\BaseModel',
            members: ['save', 'boot', 'localOnly'],
        });

        const badges = await resolveOverrideBadges(current, async fqcn => {
            const info = infoMap.get(fqcn);
            return info ? { fqcn, filePath: `${fqcn}.php`, info } : null;
        });

        assert.deepStrictEqual(
            badges.map(badge => [badge.member.name, badge.label]),
            [
                ['save', '@override @implements'],
                ['boot', '@override @trait'],
            ]
        );
        assert.deepStrictEqual(
            badges[0].targets.map(target => `${target.fqcn}::${target.methodName}`),
            ['App\\BaseModel::save', 'App\\Contracts\\SavesModel::save']
        );
    });

    it('follows interface inheritance chains', async () => {
        const infoMap = new Map<string, PhpFileInfo>([
            ['App\\Contracts\\ChildContract', makeInfo({
                className: 'ChildContract',
                classType: 'interface',
                members: ['run'],
                extendsFqcn: 'App\\Contracts\\ParentContract',
            })],
            ['App\\Contracts\\ParentContract', makeInfo({
                className: 'ParentContract',
                classType: 'interface',
                members: ['baseRun'],
            })],
        ]);

        const current = makeInfo({
            className: 'Runner',
            classType: 'class',
            implementsFqcns: ['App\\Contracts\\ChildContract'],
            members: ['run', 'baseRun'],
        });

        const badges = await resolveOverrideBadges(current, async fqcn => {
            const info = infoMap.get(fqcn);
            return info ? { fqcn, filePath: `${fqcn}.php`, info } : null;
        });

        assert.deepStrictEqual(
            badges.map(badge => [badge.member.name, badge.label]),
            [
                ['run', '@implements'],
                ['baseRun', '@implements'],
            ]
        );
    });
});

interface InfoOverrides {
    className: string;
    classType: PhpFileInfo['classType'];
    members: string[];
    extendsFqcn?: string | null;
    implementsFqcns?: string[];
    traitFqcns?: string[];
}

function makeInfo(overrides: InfoOverrides): PhpFileInfo {
    return {
        namespace: 'App',
        namespaceLoc: null,
        preambleInsertPosition: null,
        className: overrides.className,
        classType: overrides.classType,
        classLoc: null,
        extendsFqcn: overrides.extendsFqcn ?? null,
        implementsFqcns: overrides.implementsFqcns ?? [],
        traitFqcns: overrides.traitFqcns ?? [],
        useStatements: [],
        references: [],
        members: overrides.members.map((name, index) => ({
            name,
            kind: 'method',
            isStatic: false,
            loc: {
                startLine: index + 1,
                startColumn: 0,
                endLine: index + 1,
                endColumn: name.length,
                startOffset: index * 10,
                endOffset: index * 10 + name.length,
            },
        })),
    };
}
