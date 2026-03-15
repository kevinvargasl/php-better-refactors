import * as assert from 'assert';
import { parsePhpFile } from '../../src/parsers/phpParser';

describe('phpParser', () => {
    describe('parsePhpFile', () => {
        it('should extract namespace', () => {
            const result = parsePhpFile(`<?php
namespace App\\Models;

class User {}
`);
            assert.strictEqual(result.namespace, 'App\\Models');
        });

        it('should extract class name', () => {
            const result = parsePhpFile(`<?php
namespace App\\Models;

class User {}
`);
            assert.strictEqual(result.className, 'User');
            assert.strictEqual(result.classType, 'class');
        });

        it('should extract interface name', () => {
            const result = parsePhpFile(`<?php
namespace App\\Contracts;

interface UserRepository {}
`);
            assert.strictEqual(result.className, 'UserRepository');
            assert.strictEqual(result.classType, 'interface');
        });

        it('should extract trait name', () => {
            const result = parsePhpFile(`<?php
namespace App\\Traits;

trait HasFactory {}
`);
            assert.strictEqual(result.className, 'HasFactory');
            assert.strictEqual(result.classType, 'trait');
        });

        it('should extract enum name', () => {
            const result = parsePhpFile(`<?php
namespace App\\Enums;

enum Status {}
`);
            assert.strictEqual(result.className, 'Status');
            assert.strictEqual(result.classType, 'enum');
        });

        it('should extract use statements', () => {
            const result = parsePhpFile(`<?php
namespace App\\Controllers;

use App\\Models\\User;
use App\\Services\\AuthService;

class UserController {}
`);
            assert.strictEqual(result.useStatements.length, 2);
            assert.strictEqual(result.useStatements[0].fqcn, 'App\\Models\\User');
            assert.strictEqual(result.useStatements[0].shortName, 'User');
            assert.strictEqual(result.useStatements[1].fqcn, 'App\\Services\\AuthService');
        });

        it('should handle aliased imports', () => {
            const result = parsePhpFile(`<?php
use App\\Models\\User as UserModel;

class Foo {}
`);
            assert.strictEqual(result.useStatements[0].fqcn, 'App\\Models\\User');
            assert.strictEqual(result.useStatements[0].alias, 'UserModel');
            assert.strictEqual(result.useStatements[0].shortName, 'UserModel');
        });

        it('should handle group use statements', () => {
            const result = parsePhpFile(`<?php
use App\\Models\\{User, Post};

class Foo {}
`);
            assert.strictEqual(result.useStatements.length, 2);
            assert.strictEqual(result.useStatements[0].fqcn, 'App\\Models\\User');
            assert.strictEqual(result.useStatements[1].fqcn, 'App\\Models\\Post');
        });

        it('should detect extends reference', () => {
            const result = parsePhpFile(`<?php
namespace App\\Models;

use App\\Base\\Model;

class User extends Model {}
`);
            const extendsRef = result.references.find(r => r.type === 'extends');
            assert.ok(extendsRef, 'Should find extends reference');
            assert.strictEqual(extendsRef.resolvedFqcn, 'App\\Base\\Model');
        });

        it('should detect implements reference', () => {
            const result = parsePhpFile(`<?php
namespace App\\Models;

use App\\Contracts\\HasName;

class User implements HasName {}
`);
            const implRef = result.references.find(r => r.type === 'implements');
            assert.ok(implRef, 'Should find implements reference');
            assert.strictEqual(implRef.resolvedFqcn, 'App\\Contracts\\HasName');
        });

        it('should detect new expression reference', () => {
            const result = parsePhpFile(`<?php
namespace App;

use App\\Models\\User;

class Foo {
    public function bar() {
        return new User();
    }
}
`);
            const newRef = result.references.find(r => r.type === 'new');
            assert.ok(newRef, 'Should find new reference');
            assert.strictEqual(newRef.resolvedFqcn, 'App\\Models\\User');
        });

        it('should detect type hint references', () => {
            const result = parsePhpFile(`<?php
namespace App;

use App\\Models\\User;

class Foo {
    public function bar(User $user): User {
        return $user;
    }
}
`);
            const paramRef = result.references.find(r => r.type === 'param_type');
            assert.ok(paramRef, 'Should find param type reference');
            assert.strictEqual(paramRef.resolvedFqcn, 'App\\Models\\User');

            const returnRef = result.references.find(r => r.type === 'return_type');
            assert.ok(returnRef, 'Should find return type reference');
            assert.strictEqual(returnRef.resolvedFqcn, 'App\\Models\\User');
        });

        it('should not emit duplicate param_type references', () => {
            const result = parsePhpFile(`<?php
namespace App;

use App\\Models\\User;

class Foo {
    public function bar(User $user): void {}
}
`);
            const paramRefs = result.references.filter(r => r.type === 'param_type');
            assert.strictEqual(paramRefs.length, 1, `Expected 1 param_type reference but got ${paramRefs.length}`);
        });

        it('should not emit duplicate param_type references with multiple params', () => {
            const result = parsePhpFile(`<?php
namespace App;

use App\\Models\\User;
use App\\Models\\Post;

class Foo {
    public function bar(User $user, Post $post): void {}
}
`);
            const paramRefs = result.references.filter(r => r.type === 'param_type');
            assert.strictEqual(paramRefs.length, 2, `Expected 2 param_type references but got ${paramRefs.length}`);
        });

        it('should extract member declarations', () => {
            const result = parsePhpFile(`<?php
namespace App;

class Foo {
    public string $name;
    private int $age;

    public function getName(): string { return $this->name; }
    public static function create(): self { return new self(); }
}
`);
            assert.strictEqual(result.members.length, 4);
            const props = result.members.filter(m => m.kind === 'property');
            const methods = result.members.filter(m => m.kind === 'method');
            assert.strictEqual(props.length, 2);
            assert.strictEqual(methods.length, 2);
            assert.strictEqual(props[0].name, 'name');
            assert.strictEqual(methods[1].name, 'create');
            assert.strictEqual(methods[1].isStatic, true);
        });

        it('should detect static call references', () => {
            const result = parsePhpFile(`<?php
namespace App;

use App\\Models\\User;

class Foo {
    public function bar() {
        User::find(1);
    }
}
`);
            const staticRef = result.references.find(r => r.type === 'static_call');
            assert.ok(staticRef, 'Should find static call reference');
            assert.strictEqual(staticRef.resolvedFqcn, 'App\\Models\\User');
        });

        it('should detect ::class constant reference', () => {
            const result = parsePhpFile(`<?php
namespace App;

use App\\Models\\User;

class Foo {
    public function bar() {
        return User::class;
    }
}
`);
            const classRef = result.references.find(r => r.type === 'class_constant');
            assert.ok(classRef, 'Should find ::class reference');
            assert.strictEqual(classRef.resolvedFqcn, 'App\\Models\\User');
        });

        it('should detect catch references', () => {
            const result = parsePhpFile(`<?php
namespace App;

use App\\Exceptions\\CustomException;

class Foo {
    public function bar() {
        try {
        } catch (CustomException $e) {
        }
    }
}
`);
            const catchRef = result.references.find(r => r.type === 'catch');
            assert.ok(catchRef, 'Should find catch reference');
            assert.strictEqual(catchRef.resolvedFqcn, 'App\\Exceptions\\CustomException');
        });

        it('should detect instanceof references', () => {
            const result = parsePhpFile(`<?php
namespace App;

use App\\Models\\User;

class Foo {
    public function bar($x) {
        $result = $x instanceof User;
    }
}
`);
            const instRef = result.references.find(r => r.type === 'instanceof');
            assert.ok(instRef, 'Should find instanceof reference');
            assert.strictEqual(instRef.resolvedFqcn, 'App\\Models\\User');
        });

        it('should resolve unimported names using current namespace', () => {
            const result = parsePhpFile(`<?php
namespace App\\Models;

class User extends BaseModel {}
`);
            const extendsRef = result.references.find(r => r.type === 'extends');
            assert.ok(extendsRef);
            assert.strictEqual(extendsRef.resolvedFqcn, 'App\\Models\\BaseModel');
        });

        it('should handle file with no namespace', () => {
            const result = parsePhpFile(`<?php
class Helper {}
`);
            assert.strictEqual(result.namespace, null);
            assert.strictEqual(result.className, 'Helper');
        });

        it('should skip built-in types', () => {
            const result = parsePhpFile(`<?php
namespace App;

class Foo {
    public function bar(string $s, int $i): void {}
}
`);
            const typeRefs = result.references.filter(
                r => r.type === 'param_type' || r.type === 'return_type'
            );
            assert.strictEqual(typeRefs.length, 0);
        });

        it('should handle nullable types', () => {
            const result = parsePhpFile(`<?php
namespace App;

use App\\Models\\User;

class Foo {
    public function bar(?User $user): ?User {
        return $user;
    }
}
`);
            const paramRef = result.references.find(r => r.type === 'param_type');
            assert.ok(paramRef, 'Should find nullable param type');
            assert.strictEqual(paramRef.resolvedFqcn, 'App\\Models\\User');
        });

        it('should set classLoc to the name token, not the entire class node', () => {
            const result = parsePhpFile(`<?php
class User extends Base {
    public function foo(): void {}
}
`);
            assert.ok(result.classLoc, 'Should have classLoc');
            // classLoc should cover just "User", not the entire class body
            assert.strictEqual(result.classLoc.startLine, result.classLoc.endLine,
                'classLoc should be on a single line (just the name)');
        });

        it('should handle empty/invalid PHP', () => {
            const result = parsePhpFile('');
            assert.strictEqual(result.namespace, null);
            assert.strictEqual(result.className, null);
        });

    });
});
