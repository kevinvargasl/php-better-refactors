import * as assert from 'assert';
import { buildExcludeSegments, matchesExcludeSegments } from '../../src/utils/excludeUtils';

describe('buildExcludeSegments', () => {
    it('strips ** and converts to path segments', () => {
        const segments = buildExcludeSegments(['**/vendor/**', '**/node_modules/**']);
        assert.deepStrictEqual(segments, ['/vendor/', '/node_modules/']);
    });

    it('handles storage pattern', () => {
        const segments = buildExcludeSegments(['**/storage/**']);
        assert.deepStrictEqual(segments, ['/storage/']);
    });

    it('handles dotfile cache patterns', () => {
        const segments = buildExcludeSegments(['**/.phpunit.cache/**', '**/.phpstan/**', '**/.php-cs-fixer.cache/**']);
        assert.deepStrictEqual(segments, ['/.phpunit.cache/', '/.phpstan/', '/.php-cs-fixer.cache/']);
    });

    it('ignores empty segments', () => {
        const segments = buildExcludeSegments(['**/**', '**/vendor/**']);
        assert.deepStrictEqual(segments, ['/vendor/']);
    });
});

describe('matchesExcludeSegments', () => {
    const defaultSegments = buildExcludeSegments([
        '**/vendor/**',
        '**/node_modules/**',
        '**/storage/**',
        '**/.phpunit.cache/**',
        '**/.phpstan/**',
        '**/.php-cs-fixer.cache/**',
    ]);

    it('excludes vendor files', () => {
        assert.strictEqual(matchesExcludeSegments('vendor/laravel/framework/src/Foo.php', defaultSegments), true);
    });

    it('excludes storage/framework/views', () => {
        assert.strictEqual(matchesExcludeSegments('storage/framework/views/abc123.php', defaultSegments), true);
    });

    it('excludes .phpunit.cache', () => {
        assert.strictEqual(matchesExcludeSegments('.phpunit.cache/result.cache', defaultSegments), true);
    });

    it('excludes .phpstan', () => {
        assert.strictEqual(matchesExcludeSegments('.phpstan/result.php', defaultSegments), true);
    });

    it('excludes .php-cs-fixer.cache', () => {
        assert.strictEqual(matchesExcludeSegments('.php-cs-fixer.cache/something.php', defaultSegments), true);
    });

    it('does not exclude app source files', () => {
        assert.strictEqual(matchesExcludeSegments('app/Models/Category.php', defaultSegments), false);
    });

    it('does not exclude test files', () => {
        assert.strictEqual(matchesExcludeSegments('tests/Feature/CategoryTest.php', defaultSegments), false);
    });

    it('does not exclude files that merely contain the word vendor in name', () => {
        assert.strictEqual(matchesExcludeSegments('app/Services/VendorService.php', defaultSegments), false);
    });
});
