import * as vscode from 'vscode';
import { ReferenceIndex } from '../services/referenceIndex';
import { getCachedParse } from '../utils/parseCache';
import { resolveOverrideBadges } from '../services/overrideResolver';
import { OverrideInfoRepository } from '../services/overrideInfoRepository';
import { normalizePath } from '../utils/pathUtils';

export class OverrideCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
    private static readonly REFRESH_DEBOUNCE_MS = 150;
    private readonly onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this.onDidChangeCodeLensesEmitter.event;
    private readonly disposables: vscode.Disposable[];
    private readonly overrideInfoRepository: OverrideInfoRepository;
    private refreshTimer: NodeJS.Timeout | undefined;

    constructor(private readonly referenceIndex: ReferenceIndex) {
        this.overrideInfoRepository = new OverrideInfoRepository(referenceIndex);
        this.disposables = [
            this.overrideInfoRepository,
            this.referenceIndex.onDidUpdate(filePath => {
                if (!filePath || !this.isOpenDocument(filePath)) {
                    this.scheduleRefresh();
                }
            }),
            vscode.workspace.onDidChangeTextDocument(event => {
                if (event.document.languageId === 'php') {
                    this.scheduleRefresh();
                }
            }),
        ];
    }

    dispose(): void {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = undefined;
        }
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.onDidChangeCodeLensesEmitter.dispose();
    }

    private scheduleRefresh(): void {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = undefined;
            this.onDidChangeCodeLensesEmitter.fire();
        }, OverrideCodeLensProvider.REFRESH_DEBOUNCE_MS);
    }

    private isOpenDocument(filePath: string): boolean {
        const normalizedPath = normalizePath(filePath);
        return vscode.workspace.textDocuments.some(document =>
            document.uri.scheme === 'file' && normalizePath(document.uri.fsPath) === normalizedPath
        );
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
