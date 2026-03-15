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
    });
});
