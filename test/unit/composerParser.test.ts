import * as assert from 'assert';
import { parseComposerJson } from '../../src/parsers/composerParser';

describe('composerParser', () => {
    describe('parseComposerJson', () => {
        it('should extract PSR-4 autoload mappings', () => {
            const content = JSON.stringify({
                autoload: {
                    'psr-4': {
                        'App\\': 'src/',
                    },
                },
            });

            const mappings = parseComposerJson(content, '/project');
            assert.strictEqual(mappings.length, 1);
            assert.strictEqual(mappings[0].prefix, 'App\\');
            assert.deepStrictEqual(mappings[0].directories, ['src/']);
            assert.strictEqual(mappings[0].composerDir, '/project');
        });

        it('should extract autoload-dev mappings', () => {
            const content = JSON.stringify({
                'autoload-dev': {
                    'psr-4': {
                        'Tests\\': 'tests/',
                    },
                },
            });

            const mappings = parseComposerJson(content, '/project');
            assert.strictEqual(mappings.length, 1);
            assert.strictEqual(mappings[0].prefix, 'Tests\\');
        });

        it('should handle both autoload and autoload-dev', () => {
            const content = JSON.stringify({
                autoload: {
                    'psr-4': {
                        'App\\': 'src/',
                    },
                },
                'autoload-dev': {
                    'psr-4': {
                        'Tests\\': 'tests/',
                    },
                },
            });

            const mappings = parseComposerJson(content, '/project');
            assert.strictEqual(mappings.length, 2);
        });

        it('should handle array of directories', () => {
            const content = JSON.stringify({
                autoload: {
                    'psr-4': {
                        'App\\': ['src/', 'lib/'],
                    },
                },
            });

            const mappings = parseComposerJson(content, '/project');
            assert.strictEqual(mappings.length, 1);
            assert.deepStrictEqual(mappings[0].directories, ['src/', 'lib/']);
        });

        it('should normalize directory paths to end with /', () => {
            const content = JSON.stringify({
                autoload: {
                    'psr-4': {
                        'App\\': 'src',
                    },
                },
            });

            const mappings = parseComposerJson(content, '/project');
            assert.deepStrictEqual(mappings[0].directories, ['src/']);
        });

        it('should handle invalid JSON gracefully', () => {
            const mappings = parseComposerJson('not json', '/project');
            assert.deepStrictEqual(mappings, []);
        });

        it('should log a warning when JSON parsing fails', () => {
            const warnings: any[][] = [];
            const origWarn = console.warn;
            console.warn = (...args: any[]) => { warnings.push(args); };
            try {
                parseComposerJson('{{invalid', '/project');
            } finally {
                console.warn = origWarn;
            }
            assert.strictEqual(warnings.length, 1);
            assert.ok(
                (warnings[0][0] as string).includes('PHP Better Refactors'),
                'Warning should include extension prefix'
            );
        });

        it('should handle missing psr-4 key', () => {
            const content = JSON.stringify({
                autoload: {
                    classmap: ['legacy/'],
                },
            });

            const mappings = parseComposerJson(content, '/project');
            assert.deepStrictEqual(mappings, []);
        });

        it('should handle multiple prefixes', () => {
            const content = JSON.stringify({
                autoload: {
                    'psr-4': {
                        'App\\': 'src/',
                        'App\\Models\\': 'models/',
                        'Vendor\\Package\\': 'packages/vendor/',
                    },
                },
            });

            const mappings = parseComposerJson(content, '/project');
            assert.strictEqual(mappings.length, 3);
        });

        it('should reject invalid PSR-4 prefix keys', () => {
            const content = JSON.stringify({
                autoload: {
                    'psr-4': {
                        '__proto__': 'src/',
                        '123Invalid\\': 'lib/',
                        'App\\': 'src/',
                    },
                },
            });

            const mappings = parseComposerJson(content, '/project');
            assert.strictEqual(mappings.length, 1);
            assert.strictEqual(mappings[0].prefix, 'App\\');
        });

        it('should reject directories with path traversal', () => {
            const content = JSON.stringify({
                autoload: {
                    'psr-4': {
                        'App\\': '../../etc/',
                        'Tests\\': '../outside',
                    },
                },
            });

            const mappings = parseComposerJson(content, '/project');
            assert.strictEqual(mappings.length, 0);
        });

        it('should keep valid directories and reject traversal in mixed arrays', () => {
            const content = JSON.stringify({
                autoload: {
                    'psr-4': {
                        'App\\': ['src/', '../evil/'],
                    },
                },
            });

            const mappings = parseComposerJson(content, '/project');
            assert.strictEqual(mappings.length, 1);
            assert.deepStrictEqual(mappings[0].directories, ['src/']);
        });

        it('should reject prefix without trailing backslash', () => {
            const content = JSON.stringify({
                autoload: {
                    'psr-4': {
                        'App': 'src/',
                    },
                },
            });

            const mappings = parseComposerJson(content, '/project');
            assert.strictEqual(mappings.length, 0);
        });
    });
});
