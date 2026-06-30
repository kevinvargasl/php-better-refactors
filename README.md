<h3 align="center">
<img src="https://raw.githubusercontent.com/kevinvargasl/php-better-refactors/main/assets/logo.png" width="100" alt="Logo"/><br/>
PHP Better Refactors
</h3>

PSR-4-aware PHP refactoring for VS Code. Automatically updates class names, namespaces, and all references across your project when you rename or move files. Includes classes, interfaces, traits and enums.

## Features

- **Rename Symbol** for class names, methods, properties, and constructor promoted properties with cross-project reference updates
- **File rename → Class rename** — renaming `User.php` to `Account.php` renames class `User` to class `Account` and updates all references
- **File move → Namespace update** — moving a file to a different folder updates the `namespace` declaration and cross-project reference updates
- **Import class** quick fix — suggests adding `use` statements for unresolved class references
- **Override CodeLens** — shows clickable markers such as `@override` above PHP methods that override a parent method, implement an interface contract, or match a trait method
- Updates all `use` statements, type hints, `new`, `extends`, `implements`, `::class`, `catch`, `instanceof`, attributes, and more
- Handles group use statements, aliased imports, and fully-qualified references
- PSR-4 namespace resolution from `composer.json`

## Demos

<details>
<summary>Rename Symbol</summary>

Right-click a class name, method, or property and select **Rename Symbol**. The declaration, file, and all references across the project are updated.

![Rename Symbol](https://raw.githubusercontent.com/kevinvargasl/php-better-refactors/main/assets/rename-symbol.gif)
</details>

<details>
<summary>File Rename</summary>

Rename a `.php` file in the explorer — the class declaration and all references are updated automatically.

![File Rename](https://raw.githubusercontent.com/kevinvargasl/php-better-refactors/main/assets/file-rename.gif)
</details>

<details>
<summary>File Move</summary>

Move a file to a different folder — the namespace declaration and all references are updated.

![File Move](https://raw.githubusercontent.com/kevinvargasl/php-better-refactors/main/assets/file-move.gif)
</details>

<details>
<summary>Import Class</summary>

Use a class without a `use` statement and get a quick fix to import it.

![Import Class](https://raw.githubusercontent.com/kevinvargasl/php-better-refactors/main/assets/import-class.gif)
</details>

<details>
<summary>Override CodeLens</summary>

Methods that inherit behavior show a clickable CodeLens above the declaration. Click it to jump to the original parent, interface, or trait method. If multiple origins exist, the extension lets you pick one.

![Override CodeLens](https://raw.githubusercontent.com/kevinvargasl/php-better-refactors/main/assets/override-codelens.gif)
</details>

## Installation

### Marketplace

Visit [the extension page](https://marketplace.visualstudio.com/items?itemName=kevinvargasl.php-better-refactors) and press **install**.

### From .vsix

- Download the .vsix file from the latest [release](https://github.com/kevinvargasl/php-better-refactors/releases)
- Open VS Code
- Press Ctrl+Shift+P and run **Extensions: Install from VSIX...**
- Select the .vsix file

## Settings

All settings are under `phpBetterRefactors.*` in VS Code settings.

| Setting | Type | Default | Description |
|---|---|---|---|
| `phpBetterRefactors.enableAutoRename` | `boolean` | `true` | Automatically rename class when file is renamed |
| `phpBetterRefactors.enableAutoNamespace` | `boolean` | `true` | Automatically update namespace when file is moved |
| `phpBetterRefactors.showOverrideCodeLens` | `boolean` | `true` | Show clickable CodeLens above PHP methods that override a parent class, implement an interface, or match a trait method |
| `phpBetterRefactors.excludePatterns` | `string[]` | `["**/vendor/**", "**/node_modules/**", "**/storage/**", "**/.phpunit.cache/**", "**/.phpstan/**", "**/.php-cs-fixer.cache/**"]` | Patterns for files/folders to exclude from reference scanning |

## Commands

| Command | Description |
|---|---|
| `PHP Better Refactors: Rebuild Index` | Re-scan all PHP files and rebuild the reference index |

## Known Limitations

- References inside Blade templates (`.blade.php`) are not updated during renames or moves

## Requirements

- VS Code 1.85.0 or later
- A `composer.json` file in the workspace (for PSR-4 namespace resolution)
