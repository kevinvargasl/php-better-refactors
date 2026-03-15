import * as assert from 'assert';
import { Psr4Resolver } from '../../src/services/psr4Resolver';

describe('Psr4Resolver', () => {
    let resolver: Psr4Resolver;

    beforeEach(() => {
        resolver = new Psr4Resolver();
    });

    describe('resolveNamespace', () => {
        it('should resolve a file to its FQCN', () => {
            resolver.setMappings([{
                prefix: 'App\\',
                directories: ['src/'],
                composerDir: '/project',
            }]);

            const result = resolver.resolveNamespace('/project/src/Models/User.php');
            assert.ok(result);
            assert.strictEqual(result.fqcn, 'App\\Models\\User');
        });

        it('should resolve root-level class', () => {
            resolver.setMappings([{
                prefix: 'App\\',
                directories: ['src/'],
                composerDir: '/project',
            }]);

            const result = resolver.resolveNamespace('/project/src/Kernel.php');
            assert.ok(result);
            assert.strictEqual(result.fqcn, 'App\\Kernel');
        });

        it('should return null for file outside mapping', () => {
            resolver.setMappings([{
                prefix: 'App\\',
                directories: ['src/'],
                composerDir: '/project',
            }]);

            const result = resolver.resolveNamespace('/project/vendor/foo/Bar.php');
            assert.strictEqual(result, null);
        });

        it('should prefer longer prefix match', () => {
            resolver.setMappings([
                { prefix: 'App\\', directories: ['src/'], composerDir: '/project' },
                { prefix: 'App\\Models\\', directories: ['models/'], composerDir: '/project' },
            ]);

            const result = resolver.resolveNamespace('/project/models/User.php');
            assert.ok(result);
            assert.strictEqual(result.fqcn, 'App\\Models\\User');
        });

        it('should handle deeply nested paths', () => {
            resolver.setMappings([{
                prefix: 'App\\',
                directories: ['src/'],
                composerDir: '/project',
            }]);

            const result = resolver.resolveNamespace('/project/src/Http/Controllers/Api/UserController.php');
            assert.ok(result);
            assert.strictEqual(result.fqcn, 'App\\Http\\Controllers\\Api\\UserController');
        });
    });

    describe('resolveFilePath', () => {
        it('should resolve a FQCN to file path', () => {
            resolver.setMappings([{
                prefix: 'App\\',
                directories: ['src/'],
                composerDir: '/project',
            }]);

            const result = resolver.resolveFilePath('App\\Models\\User');
            assert.ok(result);
            assert.ok(result.endsWith('src/Models/User.php'), `Expected path ending with src/Models/User.php but got: ${result}`);
        });

        it('should return null for unmatched FQCN', () => {
            resolver.setMappings([{
                prefix: 'App\\',
                directories: ['src/'],
                composerDir: '/project',
            }]);

            const result = resolver.resolveFilePath('Vendor\\Package\\Foo');
            assert.strictEqual(result, null);
        });
    });

    describe('resolveNamespaceForFile', () => {
        it('should return namespace without class name', () => {
            resolver.setMappings([{
                prefix: 'App\\',
                directories: ['src/'],
                composerDir: '/project',
            }]);

            const result = resolver.resolveNamespaceForFile('/project/src/Models/User.php');
            assert.strictEqual(result, 'App\\Models');
        });

        it('should return empty string for root-level file', () => {
            resolver.setMappings([{
                prefix: 'App\\',
                directories: ['src/'],
                composerDir: '/project',
            }]);

            const result = resolver.resolveNamespaceForFile('/project/src/Kernel.php');
            assert.strictEqual(result, 'App');
        });

        it('should return null for file outside mapping', () => {
            resolver.setMappings([{
                prefix: 'App\\',
                directories: ['src/'],
                composerDir: '/project',
            }]);

            const result = resolver.resolveNamespaceForFile('/other/dir/Foo.php');
            assert.strictEqual(result, null);
        });
    });
});
