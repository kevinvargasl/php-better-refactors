/** A PSR-4 autoload mapping from composer.json */
export interface Psr4Mapping {
    prefix: string;       // e.g. "App\\"
    directories: string[]; // e.g. ["src/"]
    composerDir: string;   // absolute path to the directory containing composer.json
}

/** Parsed information from a PHP file */
export interface PhpFileInfo {
    namespace: string | null;
    namespaceLoc: PhpLocation | null;
    className: string | null;
    classType: 'class' | 'interface' | 'trait' | 'enum' | null;
    classLoc: PhpLocation | null;
    useStatements: UseStatement[];
    references: ClassReference[];
    members: MemberDeclaration[];
}

/** A method or property declaration in a class */
export interface MemberDeclaration {
    name: string;
    kind: 'method' | 'property';
    isStatic: boolean;
    loc: PhpLocation;
}

/** A use statement in a PHP file */
export interface UseStatement {
    fqcn: string;         // fully qualified class name (without leading \)
    alias: string | null;  // alias if "use X as Y"
    shortName: string;     // the short name used in code (alias or last segment)
    loc: PhpLocation;
    /** For group use: the group prefix and item range within the group */
    groupPrefix?: string;
}

/** A reference to a class in PHP code */
export interface ClassReference {
    name: string;          // the name as written in code
    resolvedFqcn: string;  // resolved FQCN
    type: ReferenceType;
    loc: PhpLocation;
}

export type ReferenceType =
    | 'new'
    | 'extends'
    | 'implements'
    | 'static_call'
    | 'type_hint'
    | 'catch'
    | 'instanceof'
    | 'class_constant'
    | 'attribute'
    | 'return_type'
    | 'property_type'
    | 'param_type';

/** Location in a PHP file */
export interface PhpLocation {
    startLine: number;   // 1-based
    startColumn: number; // 0-based
    endLine: number;
    endColumn: number;
    startOffset: number;
    endOffset: number;
}

/** An entry in the reference index */
export interface IndexEntry {
    filePath: string;
    namespace: string | null;
    declaredFqcn: string | null;
    useStatements: UseStatement[];
    references: ClassReference[];
}

/** Configuration for the extension */
export interface ExtensionConfig {
    enableAutoRename: boolean;
    enableAutoNamespace: boolean;
    excludePatterns: string[];
}

/** Result of resolving a file path to a FQCN */
export interface Psr4Resolution {
    fqcn: string;
    mapping: Psr4Mapping;
}
