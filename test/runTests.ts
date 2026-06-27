import * as path from 'path';
import * as os from 'os';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { runTests } from '@vscode/test-electron';

async function main() {
    let testWorkspace: string | undefined;
    try {
        const extensionDevelopmentPath = path.resolve(__dirname, '../../');
        const extensionTestsPath = path.resolve(__dirname, './suite/index');
        const fixtureWorkspace = path.resolve(__dirname, '../../test/fixtures/workspace');
        testWorkspace = await mkdtemp(path.join(os.tmpdir(), 'php-better-refactors-'));
        await cp(fixtureWorkspace, testWorkspace, { recursive: true });

        const vscodeDir = path.join(testWorkspace, '.vscode');
        await mkdir(vscodeDir, { recursive: true });
        await writeFile(path.join(vscodeDir, 'settings.json'), JSON.stringify({
            'phpBetterRefactors.excludePatterns': [
                '**/vendor/**',
                '**/node_modules/**',
                '**/storage/**',
                '**/.phpunit.cache/**',
                '**/.phpstan/**',
                '**/.php-cs-fixer.cache/**',
                '**/*.generated.php',
            ],
        }, null, 2));

        await runTests({
            version: process.env.VSCODE_TEST_VERSION || '1.85.0',
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [
                testWorkspace,
                `--user-data-dir=${path.join(testWorkspace, '.vscode-test-user-data')}`,
                `--extensions-dir=${path.join(testWorkspace, '.vscode-test-extensions')}`,
            ],
        });
    } catch (err) {
        console.error('Failed to run tests', err);
        process.exitCode = 1;
    } finally {
        if (testWorkspace) {
            await rm(testWorkspace, { recursive: true, force: true });
        }
    }
}

main();
