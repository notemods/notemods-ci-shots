// Pure Enter logic. No Obsidian and no CodeMirror imports, so the golden vectors run it directly.
// The editor layer (editor.ts) adds the syntax tree, IME, Vim and popup checks before it calls enterAction.

export type LineBreakStyle = 'newline' | 'spaces' | 'html';
export type EnterKey = 'Enter' | 'Shift-Enter';

export interface EnterSettings {
	enabled: boolean;
	lineBreakStyle?: LineBreakStyle;
	/** The key that the user pressed. Default "Enter". */
	key?: EnterKey;
}

export interface EnterChange { from: number; to: number; insert: string }
/** A change set, the new cursor, and the document after the change. */
export interface EnterEdit { changes: EnterChange[]; cursor: number; doc: string }
export type EnterResult = 'default' | EnterEdit;
export type CursorArg = number | { anchor: number; head?: number };

export const LINE_BREAKS: Readonly<Record<LineBreakStyle, string>> = { newline: '\n', spaces: '  \n', html: '<br>\n' };
export const LINE_BREAK_LABELS: Readonly<Record<LineBreakStyle, string>> = { newline: 'Line break', spaces: 'Two spaces', html: 'HTML' };
export function isLineBreakStyle(value: unknown): value is LineBreakStyle {
	return value === 'newline' || value === 'spaces' || value === 'html';
}

/** The block that holds a line. null is a line outside fenced code, math, front matter and comments. */
export type BlockKind = 'frontmatter' | 'code' | 'math' | 'comment' | null;

const FENCE = /^\s*(`{3,}|~{3,})/;
const BLANK = /^\s*$/;
const HEADING = /^ {0,3}#{1,6}(\s|$)/;
const LIST = /^\s*([-*+]|\d{1,9}[.)])(\s|$)/;
const QUOTE = /^\s*>/;
const INDENTED = /^( {4}|\t)/;
const HTML = /^\s*<[A-Za-z/!?]/;
const RULE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const SETEXT = /^ {0,3}(=+|-+)\s*$/;
const DEFINITION = /^ {0,3}\[[^\]]+\]:/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function count(text: string, token: string): number {
	let n = 0;
	for (let i = text.indexOf(token); i !== -1; i = text.indexOf(token, i + token.length)) n++;
	return n;
}

/**
 * The block kind of each line from 0 to last. The scan starts at the top of the note, because a fence,
 * a math block or a comment can open many lines above the cursor.
 */
export function blockKinds(lines: readonly string[], last = lines.length - 1): BlockKind[] {
	const kinds: BlockKind[] = [];
	let open: BlockKind = null;
	let fence = '';
	for (let i = 0; i <= last && i < lines.length; i++) {
		const line = lines[i]!;
		if (open === 'frontmatter') {
			kinds.push('frontmatter');
			if (line === '---' || line === '...') open = null;
			continue;
		}
		if (open === 'code') {
			kinds.push('code');
			const m = FENCE.exec(line);
			if (m && m[1]![0] === fence[0] && m[1]!.length >= fence.length && BLANK.test(line.slice(m[0].length))) open = null;
			continue;
		}
		if (open === 'math') {
			kinds.push('math');
			if (count(line, '$$') % 2 === 1) open = null;
			continue;
		}
		if (open === 'comment') {
			kinds.push('comment');
			if (count(line, '%%') % 2 === 1) open = null;
			continue;
		}
		if (i === 0 && line === '---') { open = 'frontmatter'; kinds.push('frontmatter'); continue; }
		const fenceMatch = FENCE.exec(line);
		if (fenceMatch) { open = 'code'; fence = fenceMatch[1]!; kinds.push('code'); continue; }
		const math = count(line, '$$');
		if (math > 0) { kinds.push('math'); if (math % 2 === 1) open = 'math'; continue; }
		const comment = count(line, '%%');
		if (comment > 0) { kinds.push('comment'); if (comment % 2 === 1) open = 'comment'; continue; }
		kinds.push(null);
	}
	return kinds;
}

/** A line that starts or continues a container: list, task, quote, callout, HTML, indented code, definition. */
function containerLine(line: string): boolean {
	return LIST.test(line) || QUOTE.test(line) || HTML.test(line) || INDENTED.test(line) || DEFINITION.test(line);
}

/**
 * True when line `index` is a line of a plain paragraph. Every other context keeps the default Enter:
 * lists, tasks, quotes, callouts, tables, code, math, front matter, comments, headings, HTML and rules.
 */
export function isParagraphLine(lines: readonly string[], index: number): boolean {
	const line = lines[index];
	if (line === undefined || BLANK.test(line)) return false;
	const kinds = blockKinds(lines, Math.min(lines.length - 1, index + 1));
	if (kinds[index] !== null) return false;
	if (HEADING.test(line) || RULE.test(line) || containerLine(line) || line.trimStart().startsWith('|')) return false;
	// "Text" over "---" or "===" is a heading, not a paragraph.
	const next = lines[index + 1];
	if (next !== undefined && kinds[index + 1] === null && SETEXT.test(next)) return false;
	// A lazy continuation line belongs to the list or quote above it.
	let start = index;
	while (start > 0) {
		const prev = lines[start - 1]!;
		if (BLANK.test(prev) || kinds[start - 1] !== null || HEADING.test(prev) || RULE.test(prev)) break;
		if (containerLine(prev) || prev.trimStart().startsWith('|')) return false;
		start--;
	}
	// A table needs a delimiter row. Pipes in a plain paragraph do not make a table.
	if (line.includes('|')) {
		for (let i = start; i < lines.length; i++) {
			const row = lines[i]!;
			if (i > index && (BLANK.test(row) || HEADING.test(row))) break;
			if (row.includes('-') && row.includes('|') && TABLE_DELIMITER.test(row)) return false;
			if (i > index + 1) break;
		}
	}
	return true;
}

function lineStarts(lines: readonly string[]): number[] {
	const starts: number[] = [];
	let pos = 0;
	for (const line of lines) { starts.push(pos); pos += line.length + 1; }
	return starts;
}

function edit(doc: string, changes: EnterChange[], cursor: number): EnterEdit {
	let out = doc;
	for (const c of [...changes].sort((a, b) => b.from - a.from)) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
	return { changes, cursor, doc: out };
}

/**
 * What one Enter or Shift+Enter does at `cursor` in `doc`. "default" means: let Obsidian handle the key.
 *
 * Enter in a plain paragraph line:
 * - at the end of the line, insert two line breaks (a blank line and the new paragraph line);
 * - when a blank line follows, insert no second blank line: move the cursor down instead;
 * - in the middle of the line, split the paragraph into two paragraphs.
 * Shift+Enter in a plain paragraph line inserts the line break of the chosen style.
 */
export function enterAction(doc: string, cursor: CursorArg, settings: EnterSettings): EnterResult {
	if (!settings.enabled) return 'default';
	const anchor = typeof cursor === 'number' ? cursor : cursor.anchor;
	const head = typeof cursor === 'number' ? cursor : (cursor.head ?? cursor.anchor);
	if (anchor !== head || head < 0 || head > doc.length) return 'default';
	const lines = doc.split('\n');
	const starts = lineStarts(lines);
	let index = lines.length - 1;
	while (index > 0 && starts[index]! > head) index--;
	const line = lines[index]!;
	const lineFrom = starts[index]!;
	const lineTo = lineFrom + line.length;
	const col = head - lineFrom;
	const before = line.slice(0, col);
	const rest = line.slice(col);
	// At the start of a line, or inside its indentation, a new paragraph is not a split. Keep the default.
	if (BLANK.test(before)) return 'default';
	if (!isParagraphLine(lines, index)) return 'default';

	if (settings.key === 'Shift-Enter') {
		const style = settings.lineBreakStyle ?? 'newline';
		const insert = LINE_BREAKS[style];
		// Two spaces mark the break. Spaces that are already before the cursor are replaced, not doubled.
		const from = style === 'spaces' ? head - (before.length - before.trimEnd().length) : head;
		return edit(doc, [{ from, to: head, insert }], from + insert.length);
	}

	if (!BLANK.test(rest)) {
		// Middle of the line: split the paragraph. Spaces at the cursor do not start the new paragraph.
		const to = head + (rest.length - rest.trimStart().length);
		return edit(doc, [{ from: head, to, insert: '\n\n' }], head + 2);
	}

	// End of the line. Count the blank lines that follow.
	let blanks = 0;
	while (index + 1 + blanks < lines.length && BLANK.test(lines[index + 1 + blanks]!)) blanks++;
	if (blanks === 0) return edit(doc, [{ from: head, to: lineTo, insert: '\n\n' }], head + 2);
	const last = index + blanks === lines.length - 1;
	if (blanks === 1 && last) {
		// "Hello|" + one empty last line: add only the line break that is missing.
		return edit(doc, [{ from: head, to: doc.length, insert: '\n\n' }], head + 2);
	}
	// Do not insert a second empty line. Move to the empty line; with two or more, to the second one,
	// so that a blank line separates the new paragraph from this one.
	const target = blanks >= 2 ? index + 2 : index + 1;
	return { changes: [], cursor: starts[target]!, doc };
}
