// Pure Enter logic. No Obsidian and no CodeMirror imports, so the golden vectors run it directly.
// The editor layer (editor.ts) adds the syntax tree, nested editor, IME, Vim and popup checks before it calls
// planEnter with a line source over the editor document. Nothing here copies the whole note.

export type LineBreakStyle = 'newline' | 'spaces' | 'html';
export type EnterKey = 'Enter' | 'Shift-Enter';

export interface EnterSettings {
	enabled: boolean;
	lineBreakStyle?: LineBreakStyle;
	/** The key that the user pressed. Default "Enter". */
	key?: EnterKey;
}

export interface EnterChange { from: number; to: number; insert: string }
/** A change set and the new cursor. */
export interface EnterPlan { changes: EnterChange[]; cursor: number }
/** A plan plus the document after the change (the golden vector format). */
export interface EnterEdit extends EnterPlan { doc: string }
export type EnterResult = 'default' | EnterEdit;
export type PlanResult = 'default' | EnterPlan;
export type CursorArg = number | { anchor: number; head?: number };

/** Read access to the lines of a document. Line numbers start at 0. */
export interface LineSource {
	readonly count: number;
	readonly length: number;
	text(line: number): string;
	from(line: number): number;
}

export const LINE_BREAKS: Readonly<Record<LineBreakStyle, string>> = { newline: '\n', spaces: '  \n', html: '<br>\n' };
export const LINE_BREAK_LABELS: Readonly<Record<LineBreakStyle, string>> = { newline: 'Line break', spaces: 'Two spaces', html: 'HTML' };
export function isLineBreakStyle(value: unknown): value is LineBreakStyle {
	return value === 'newline' || value === 'spaces' || value === 'html';
}

/**
 * The text scan looks back at most this many lines from the cursor for an open fence, math block, comment or
 * front matter. When the note is longer and the syntax tree does not cover the line, Enter keeps the default.
 */
export const LOOK_BACK = 2000;

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
const EMBED_ONLY = /^\s*!(\[\[[^\]]*\]\]|\[[^\]]*\]\([^)]*\))\s*$/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function count(text: string, token: string): number {
	let n = 0;
	for (let i = text.indexOf(token); i !== -1; i = text.indexOf(token, i + token.length)) n++;
	return n;
}

/** A line source over a string. Used by the vectors and the tests. */
export function stringLines(doc: string): LineSource {
	const lines = doc.split('\n');
	const starts: number[] = [];
	let pos = 0;
	for (const line of lines) { starts.push(pos); pos += line.length + 1; }
	return { count: lines.length, length: doc.length, text: (i) => lines[i]!, from: (i) => starts[i]! };
}

/** The block kind of each line from `first` to `last`, as an array that starts at `first`. */
export function blockKinds(src: LineSource, first: number, last: number): BlockKind[] {
	const kinds: BlockKind[] = [];
	let open: BlockKind = null;
	let fence = '';
	for (let i = first; i <= last && i < src.count; i++) {
		const line = src.text(i);
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

/** A line that starts a new block. Such a line cannot continue the paragraph above it. */
function blockStart(line: string): boolean {
	return BLANK.test(line) || HEADING.test(line) || RULE.test(line) || LIST.test(line) || QUOTE.test(line) || HTML.test(line)
		|| DEFINITION.test(line) || FENCE.test(line) || EMBED_ONLY.test(line) || line.trimStart().startsWith('|')
		|| line.includes('$$') || line.includes('%%');
}

/** Line context for one cursor line: the scan start and the block kinds from there to the next line. */
interface Context { first: number; kind(line: number): BlockKind | undefined }

function context(src: LineSource, index: number): Context {
	const first = Math.max(0, index - LOOK_BACK);
	const kinds = blockKinds(src, first, Math.min(src.count - 1, index + 1));
	return { first, kind: (line) => kinds[line - first] };
}

/**
 * True when line `index` is a line of a plain paragraph. Every other context keeps the default Enter:
 * lists, tasks, quotes, callouts, tables, code, math, front matter, comments, headings, HTML, rules and
 * lines that hold only an embed.
 */
export function isParagraphLine(src: LineSource, index: number, ctx = context(src, index)): boolean {
	if (index < 0 || index >= src.count) return false;
	const line = src.text(index);
	if (BLANK.test(line) || ctx.kind(index) !== null) return false;
	if (HEADING.test(line) || RULE.test(line) || EMBED_ONLY.test(line) || containerLine(line) || line.trimStart().startsWith('|')) return false;
	// "Text" over "---" or "===" is a heading, not a paragraph.
	if (index + 1 < src.count && ctx.kind(index + 1) === null && SETEXT.test(src.text(index + 1))) return false;
	// A lazy continuation line belongs to the list or quote above it.
	let start = index;
	while (start > ctx.first) {
		const prev = src.text(start - 1);
		if (BLANK.test(prev) || ctx.kind(start - 1) !== null || HEADING.test(prev) || RULE.test(prev)) break;
		if (containerLine(prev) || prev.trimStart().startsWith('|')) return false;
		start--;
	}
	// A table needs a delimiter row. Pipes in a plain paragraph do not make a table.
	if (line.includes('|')) {
		for (let i = start; i < src.count && i <= index + 1; i++) {
			const row = src.text(i);
			if (i > index && (BLANK.test(row) || HEADING.test(row))) break;
			if (row.includes('-') && row.includes('|') && TABLE_DELIMITER.test(row)) return false;
		}
	}
	return true;
}

/**
 * What one Enter or Shift+Enter does at column `col` of line `index`. "default" means: let Obsidian handle the key.
 * `treeCovers` is true when the syntax tree has checked this line; without it, a note longer than LOOK_BACK lines
 * above the cursor keeps the default, because an open block can start above the scanned lines.
 *
 * Enter in a plain paragraph line always leaves the cursor on an empty line with a blank line above it, and with a
 * blank line below it when more text follows. So text that you type there is its own paragraph.
 */
export function planEnter(src: LineSource, index: number, col: number, settings: EnterSettings, treeCovers = false): PlanResult {
	if (!settings.enabled || index < 0 || index >= src.count) return 'default';
	const ctx = context(src, index);
	if (ctx.first > 0 && !treeCovers) return 'default';
	const line = src.text(index);
	const lineFrom = src.from(index);
	const lineTo = lineFrom + line.length;
	const head = lineFrom + col;
	const before = line.slice(0, col);
	const rest = line.slice(col);
	// At the start of a line, or inside its indentation, a new paragraph is not a split. Keep the default.
	if (BLANK.test(before)) return 'default';
	if (!isParagraphLine(src, index, ctx)) return 'default';

	if (settings.key === 'Shift-Enter') {
		const style = settings.lineBreakStyle ?? 'newline';
		const insert = LINE_BREAKS[style];
		// Two spaces mark the break. Spaces that are already before the cursor are replaced, not doubled.
		const from = style === 'spaces' ? head - (before.length - before.trimEnd().length) : head;
		return { changes: [{ from, to: head, insert }], cursor: from + insert.length };
	}

	if (!BLANK.test(rest)) {
		// Middle of the line: split the paragraph. Spaces at the cursor do not start the new paragraph.
		const to = head + (rest.length - rest.trimStart().length);
		return { changes: [{ from: head, to, insert: '\n\n' }], cursor: head + 2 };
	}

	// End of the line. Count the blank lines that follow.
	let blanks = 0;
	while (index + 1 + blanks < src.count && BLANK.test(src.text(index + 1 + blanks))) blanks++;
	const after = index + 1 + blanks;
	const textFollows = after < src.count;
	if (blanks === 0) {
		if (!textFollows) return { changes: [{ from: head, to: lineTo, insert: '\n\n' }], cursor: head + 2 };
		const next = src.text(index + 1);
		if (ctx.kind(index + 1) === null && !blockStart(next)) {
			// The next line continues this paragraph after a soft line break: split the paragraph there.
			const to = src.from(index + 1) + (next.length - next.trimStart().length);
			return { changes: [{ from: head, to, insert: '\n\n' }], cursor: head + 2 };
		}
		// A list, heading, fence or other block follows: open an empty paragraph between blank lines.
		return { changes: [{ from: head, to: lineTo, insert: '\n\n\n' }], cursor: head + 2 };
	}
	if (!textFollows) {
		// Only empty lines follow. One: add the missing line break. Two or more: use the second one.
		if (blanks === 1) return { changes: [{ from: head, to: src.length, insert: '\n\n' }], cursor: head + 2 };
		return { changes: [], cursor: src.from(index + 2) };
	}
	// Text follows the empty lines. Put the cursor on an empty line with a blank line above and below it.
	if (blanks === 1) return { changes: [{ from: head, to: lineTo, insert: '\n\n' }], cursor: head + 2 };
	const target = src.from(index + 2);
	if (blanks === 2) return { changes: [{ from: target, to: target, insert: '\n' }], cursor: target };
	return { changes: [], cursor: target };
}

function apply(doc: string, changes: EnterChange[]): string {
	let out = doc;
	for (const c of [...changes].sort((a, b) => b.from - a.from)) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
	return out;
}

/**
 * The golden vector function: what one Enter or Shift+Enter does at `cursor` in `docBefore`.
 * Returns "default" or the changes, the new cursor and the document after the change.
 */
export function enterAction(docBefore: string, cursor: CursorArg, settings: EnterSettings): EnterResult {
	if (!settings.enabled) return 'default';
	const anchor = typeof cursor === 'number' ? cursor : cursor.anchor;
	const head = typeof cursor === 'number' ? cursor : (cursor.head ?? cursor.anchor);
	if (anchor !== head || head < 0 || head > docBefore.length) return 'default';
	const src = stringLines(docBefore);
	let index = src.count - 1;
	while (index > 0 && src.from(index) > head) index--;
	const plan = planEnter(src, index, head - src.from(index), settings);
	return plan === 'default' ? 'default' : { ...plan, doc: apply(docBefore, plan.changes) };
}
