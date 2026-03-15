import * as path from 'path';
import * as fs from 'fs';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Mocha = require('mocha');

export function run(): Promise<void> {
    const mocha = new Mocha({
        ui: 'bdd',
        color: true,
    });

    const testsRoot = path.resolve(__dirname, '..');

    return new Promise((resolve, reject) => {
        const files = findTestFiles(testsRoot);
        files.forEach((f: string) => mocha.addFile(f));

        try {
            mocha.run((failures: number) => {
                if (failures > 0) {
                    reject(new Error(`${failures} tests failed.`));
                } else {
                    resolve();
                }
            });
        } catch (err) {
            reject(err);
        }
    });
}

function findTestFiles(dir: string): string[] {
    const results: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...findTestFiles(fullPath));
        } else if (entry.name.endsWith('.test.js')) {
            results.push(fullPath);
        }
    }
    return results;
}
