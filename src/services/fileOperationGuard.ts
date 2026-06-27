import * as vscode from 'vscode';
import { normalizePath } from '../utils/pathUtils';

const PLANNED_RENAME_TTL_MS = 2_000;

/**
 * Coordinates file operations initiated by this extension so file-operation
 * participants do not add duplicate edits to the same WorkspaceEdit.
 */
export class FileOperationGuard implements vscode.Disposable {
    private plannedRenames = new Map<string, NodeJS.Timeout>();

    planRename(oldPath: string, newPath: string): void {
        const key = this.renameKey(oldPath, newPath);
        const existing = this.plannedRenames.get(key);
        if (existing) {
            clearTimeout(existing);
        }

        const timer = setTimeout(() => this.plannedRenames.delete(key), PLANNED_RENAME_TTL_MS);
        timer.unref();
        this.plannedRenames.set(key, timer);
    }

    consumeRename(oldPath: string, newPath: string): boolean {
        const key = this.renameKey(oldPath, newPath);
        const timer = this.plannedRenames.get(key);
        if (!timer) {
            return false;
        }

        clearTimeout(timer);
        this.plannedRenames.delete(key);
        return true;
    }

    dispose(): void {
        this.plannedRenames.forEach(timer => clearTimeout(timer));
        this.plannedRenames.clear();
    }

    private renameKey(oldPath: string, newPath: string): string {
        return `${normalizePath(oldPath)}\0${normalizePath(newPath)}`;
    }
}
