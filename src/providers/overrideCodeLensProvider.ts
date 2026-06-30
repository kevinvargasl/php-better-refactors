import * as vscode from 'vscode';
import { ReferenceIndex } from '../services/referenceIndex';
import { getCachedParse } from '../utils/parseCache';
import { resolveOverrideBadges } from '../services/overrideResolver';
import { OverrideInfoRepository } from '../services/overrideInfoRepository';

export class OverrideCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
    private readonly onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this.onDidChangeCodeLensesEmitter.event;
    private readonly disposables: vscode.Disposable[];
    private readonly overrideInfoRepository: OverrideInfoRepository;

    constructor(private readonly referenceIndex: ReferenceIndex) {
        this.overrideInfoRepository = new OverrideInfoRepository(referenceIndex);
        this.disposables = [
            this.overrideInfoRepository,
            this.referenceIndex.onDidUpdate(() => this.onDidChangeCodeLensesEmitter.fire()),
            vscode.workspace.onDidChangeTextDocument(event => {
                if (event.document.languageId === 'php') {
                    this.onDidChangeCodeLensesEmitter.fire();
                }
            }),
            vscode.workspace.onDidOpenTextDocument(document => {
                if (document.languageId === 'php') {
                    this.onDidChangeCodeLensesEmitter.fire();
                }
            }),
            vscode.workspace.onDidSaveTextDocument(document => {
                if (document.languageId === 'php') {
                    this.onDidChangeCodeLensesEmitter.fire();
                }
            }),
        ];
    }

    dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.onDidChangeCodeLensesEmitter.dispose();
    }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        if (document.languageId !== 'php' || document.uri.scheme !== 'file') {
            return [];
        }

        const info = getCachedParse(document);
        const badges = await resolveOverrideBadges(info, fqcn => this.overrideInfoRepository.loadForFqcn(fqcn));

        return badges.map(badge => new vscode.CodeLens(
            new vscode.Range(
                badge.member.loc.startLine - 1,
                badge.member.loc.startColumn,
                badge.member.loc.startLine - 1,
                badge.member.loc.endColumn
            ),
            {
                title: badge.label,
                command: 'phpBetterRefactors.goToOverrideTarget',
                arguments: [badge.targets],
                tooltip: `Go to inherited method: ${badge.targets.map(target => `${target.fqcn}::${target.methodName}`).join(', ')}`,
            }
        ));
    }
}
