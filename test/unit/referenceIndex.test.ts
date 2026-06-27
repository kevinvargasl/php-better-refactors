import * as assert from 'assert';
import { buildExcludeMatchers, matchesExcludePatterns } from '../../src/utils/excludeUtils';

describe('buildExcludeMatchers', () => {
    it('ignores empty patterns and normalizes path separators', () => {
        const matchers = buildExcludeMatchers(['', '**\\vendor\\**']);
        assert.strictEqual(matchers.length, 1);
        assert.strictEqual(matchers[0].match('vendor/package/Foo.php'), true);
    });
});

describe('matchesExcludePatterns', () => {
    const defaultMatchers = buildExcludeMatchers([
        '**/vendor/**',
        '**/node_modules/**',
        '**/storage/**',
        '**/.phpunit.cache/**',
        '**/.phpstan/**',
        '**/.php-cs-fixer.cache/**',
    ]);

    it('excludes vendor files', () => {
        assert.strictEqual(matchesExcludePatterns('vendor/laravel/framework/src/Foo.php', defaultMatchers), true);
    });

    it('excludes storage/framework/views', () => {
        assert.strictEqual(matchesExcludePatterns('storage/framework/views/abc123.php', defaultMatchers), true);
    });

    it('excludes .phpunit.cache', () => {
        assert.strictEqual(matchesExcludePatterns('.phpunit.cache/result.cache', defaultMatchers), true);
    });

    it('excludes .phpstan', () => {
        assert.strictEqual(matchesExcludePatterns('.phpstan/result.php', defaultMatchers), true);
    });

    it('excludes .php-cs-fixer.cache', () => {
        assert.strictEqual(matchesExcludePatterns('.php-cs-fixer.cache/something.php', defaultMatchers), true);
    });

    it('does not exclude app source files', () => {
        assert.strictEqual(matchesExcludePatterns('app/Models/Category.php', defaultMatchers), false);
    });

    it('does not exclude test files', () => {
        assert.strictEqual(matchesExcludePatterns('tests/Feature/CategoryTest.php', defaultMatchers), false);
    });

    it('does not exclude files that merely contain the word vendor in name', () => {
        assert.strictEqual(matchesExcludePatterns('app/Services/VendorService.php', defaultMatchers), false);
    });

    it('supports wildcard filename patterns', () => {
        const matchers = buildExcludeMatchers(['**/*.generated.php']);
        assert.strictEqual(matchesExcludePatterns('src/Models/User.generated.php', matchers), true);
        assert.strictEqual(matchesExcludePatterns('src/Models/User.php', matchers), false);
    });

    it('supports single-segment wildcards', () => {
        const matchers = buildExcludeMatchers(['src/*/Generated/**']);
        assert.strictEqual(matchesExcludePatterns('src/Domain/Generated/User.php', matchers), true);
        assert.strictEqual(matchesExcludePatterns('src/Domain/Nested/Generated/User.php', matchers), false);
    });

    it('supports brace expansion', () => {
        const matchers = buildExcludeMatchers(['**/*.{generated,cache}.php']);
        assert.strictEqual(matchesExcludePatterns('src/User.generated.php', matchers), true);
        assert.strictEqual(matchesExcludePatterns('src/User.cache.php', matchers), true);
        assert.strictEqual(matchesExcludePatterns('src/User.php', matchers), false);
    });
});
