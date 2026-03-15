import * as assert from 'assert';
import {
    isValidClassName,
    getShortName,
    getNamespacePart,
    buildFqcn,
    stripLeadingBackslash,
} from '../../src/utils/phpStringUtils';

describe('phpStringUtils', () => {
    describe('isValidClassName', () => {
        it('should accept valid PHP class names', () => {
            assert.strictEqual(isValidClassName('User'), true);
            assert.strictEqual(isValidClassName('_User'), true);
            assert.strictEqual(isValidClassName('User123'), true);
        });

        it('should reject invalid class names', () => {
            assert.strictEqual(isValidClassName('123User'), false);
            assert.strictEqual(isValidClassName(''), false);
            assert.strictEqual(isValidClassName('user-name'), false);
        });
    });

    describe('getShortName', () => {
        it('should return last segment', () => {
            assert.strictEqual(getShortName('App\\Models\\User'), 'User');
            assert.strictEqual(getShortName('User'), 'User');
        });
    });

    describe('getNamespacePart', () => {
        it('should return namespace without class', () => {
            assert.strictEqual(getNamespacePart('App\\Models\\User'), 'App\\Models');
            assert.strictEqual(getNamespacePart('User'), '');
        });
    });

    describe('buildFqcn', () => {
        it('should combine namespace and class', () => {
            assert.strictEqual(buildFqcn('App\\Models', 'User'), 'App\\Models\\User');
            assert.strictEqual(buildFqcn(null, 'User'), 'User');
        });
    });

    describe('stripLeadingBackslash', () => {
        it('should strip leading backslash', () => {
            assert.strictEqual(stripLeadingBackslash('\\App\\User'), 'App\\User');
            assert.strictEqual(stripLeadingBackslash('App\\User'), 'App\\User');
        });
    });
});
