import * as vscode from 'vscode';

const PHP_IDENTIFIER = /^[a-zA-Z_\x80-\xff][a-zA-Z0-9_\x80-\xff]*$/;

export function hasPotentialMemberReferenceText(
    text: string,
    memberName: string,
    isProperty: boolean,
): boolean {
    if (!PHP_IDENTIFIER.test(memberName)) {
        return false;
    }

    if (isProperty) {
        return text.includes(`->${memberName}`) || text.includes(`::$${memberName}`);
    }

    return text.includes(`->${memberName}`) || text.includes(`::${memberName}`);
}

/**
 * Find all occurrences of a member name (method or property) in a document.
 * Searches for patterns like ->name, ::name, and ::$name.
 */
export function findMemberReferences(
    document: vscode.TextDocument,
    memberName: string,
    isProperty: boolean,
): vscode.Range[] {
    const ranges: vscode.Range[] = [];

    if (!PHP_IDENTIFIER.test(memberName)) {
        return ranges;
    }

    const text = document.getText();
    if (!hasPotentialMemberReferenceText(text, memberName, isProperty)) {
        return ranges;
    }

    // Build patterns to match:
    // ->methodName(  or  ->propertyName  (instance access)
    // ::methodName(  or  ::$propertyName (static access)
    // Also match $this->name and self::name in the declaring file
    const escaped = memberName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    let pattern: RegExp;
    if (isProperty) {
        // Match ->name (instance) and ::$name (static)
        // Property access: ->name followed by non-word char (not method call)
        // Static property: ::$name
        pattern = new RegExp(
            `(?:->|::\\$)${escaped}(?![\\w(])`,
            'g'
        );
    } else {
        // Match ->name( and ::name( for methods
        pattern = new RegExp(
            `(?:->|::)${escaped}\\s*\\(`,
            'g'
        );
    }

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
        // The member name starts after the accessor (-> or :: or ::$)
        const accessor = match[0];
        let nameStart: number;
        if (accessor.startsWith('::$')) {
            nameStart = match.index + 3; // after ::$
        } else {
            nameStart = match.index + 2; // after -> or ::
        }
        const nameEnd = nameStart + memberName.length;

        const startPos = document.positionAt(nameStart);
        const endPos = document.positionAt(nameEnd);
        ranges.push(new vscode.Range(startPos, endPos));
    }

    return ranges;
}
