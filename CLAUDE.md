# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run compile              # Build TypeScript → ./out
npm run watch                # Build in watch mode
npm run lint                 # ESLint on src/**/*.ts
npm run test:unit            # Unit tests only (Mocha)
npm test                     # Full suite including integration tests
npx mocha ./out/test/unit/phpParser.test.js  # Single test file (compile first)
```

Tests require compiling first (`npm run compile`). Integration tests use `@vscode/test-electron` and need a VS Code instance.

## Architecture

VS Code extension providing PSR-4-aware PHP refactoring. Activates when workspace contains a `composer.json`.

### Data Flow

```
composer.json → ComposerParser → Psr4Resolver (FQCN ↔ file path mapping)
                                       ↓
*.php files → PhpParser → ReferenceIndex (workspace-wide class/reference database)
                                       ↓
                              ReferenceUpdater (builds WorkspaceEdit for bulk renames)
                                       ↓
                    ┌──────────────────┼──────────────────┐
                    ↓                  ↓                  ↓
          FileRenameHandler    RenameProvider    ImportClassProvider
          (file rename/move)   (F2 rename)      (add use statement)
```

### Key Services

- **ReferenceIndex** — scans all PHP files on activation, maintains maps: `filePath → IndexEntry`, `FQCN → filePath`, `FQCN → Set<referencingFiles>`, `shortName → FQCN[]`. Incrementally updated via file watchers.
- **Psr4Resolver** — converts between file paths and FQCNs using PSR-4 mappings. Longest-prefix match wins.
- **ReferenceUpdater** — given old/new FQCN, finds all referencing files, re-parses them for fresh locations, builds edits for use statements, inline FQCNs, and short name usages. Processes in batches of 50.
- **PhpParser** — wraps `php-parser` (glayzzle). Returns `PhpFileInfo` with namespace, class name, use statements, references (resolved to FQCNs), and member declarations.

### Reference Resolution

`referenceCollectors.ts` uses a dispatch map of AST node kind → collector function. Each collector extracts class references and resolves short names to FQCNs using use statements + current namespace. Handles: `new`, `extends`, `implements`, static calls, type hints (param/return/property), `catch`, `instanceof`, `::class`, attributes, union/intersection/nullable types.

### Location Convention

`PhpLocation` uses 1-based lines and 0-based columns. Convert to VS Code's 0-based `Range` with `locToRange()` from `workspaceEditUtils.ts`.

## Extension Configuration

Settings under `phpBetterRefactors.*`:
- `enableAutoRename` — file rename triggers class rename + reference updates
- `enableAutoNamespace` — file move triggers namespace update + reference updates
- `excludePatterns` — glob patterns to exclude from indexing (default: vendor, node_modules)
