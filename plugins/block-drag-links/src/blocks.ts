// Pure Markdown block logic: find the block at a line, find or make its block id, and build link text.
// No Obsidian import here, so the golden vectors (packages/spec/vectors/block-drag-links.json) test it directly.

/** Line classes from one scan of the note. */
export const LineClass = { Text: 0, Frontmatter: 1, Code: 2, Math: 3 } as const;

export type BlockKind = 'heading' | 'paragraph' | 'list' | 'task' | 'quote' | 'callout' | 'table';
export type RefuseKind = 'empty' | 'code' | 'math' | 'frontmatter' | 'id-line';

export interface Block {
	kind: BlockKind;
	/** First line of the block, 0-based. */
	start: number;
	/** Last line of the block, 0-based, inclusive. */
	end: number;
	/** The existing block id (without ^), or null. Always null for a heading. */
	id: string | null;
	/** Heading text as Obsidian stores it (headings only), else null. */
	heading: string | null;
}

export interface Refusal {
	kind: RefuseKind;
	refused: true;
}

export type BlockResult = Block | Refusal;

export function isRefusal(b: BlockResult): b is Refusal {
	return (b as Refusal).refused === true;
}

const FENCE = /^\s*(`{3,}|~{3,})/;
const HEADING = /^(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])(?:[ \t]+|$)/;
const TASK = /^\s*(?:[-*+]|\d{1,9}[.)])[ \t]+\[.\](?:[ \t]|$)/;
const QUOTE = /^\s{0,3}>/;
const CALLOUT = /^\s{0,3}>\s*\[!/;
const TABLE = /^\s*\|/;
/** A block id at the end of a line: a space (or line start), ^, then letters, digits and dashes. */
const END_ID = /(?:^|\s)\^([A-Za-z0-9-]+)[ \t]*$/;
const ID_LINE = /^\^([A-Za-z0-9-]+)[ \t]*$/;

/** Strips a trailing carriage return, so CRLF notes give the same lines as LF notes. */
function bare(line: string): string {
	return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/**
 * Classifies each line in one pass: front matter, fenced code, math block or text.
 * A fence closes on a line with the same character, at least as long, and nothing else.
 */
export function classifyLines(rawLines: readonly string[]): Uint8Array {
	const lines = rawLines.map(bare);
	const out = new Uint8Array(lines.length);
	let i = 0;
	if (lines[0] === '---') {
		let close = -1;
		for (let j = 1; j < lines.length; j++) {
			if (lines[j] === '---' || lines[j] === '...') {
				close = j;
				break;
			}
		}
		if (close > 0) {
			for (let j = 0; j <= close; j++) out[j] = LineClass.Frontmatter;
			i = close + 1;
		}
	}
	for (; i < lines.length; i++) {
		const line = lines[i] ?? '';
		const fence = FENCE.exec(line);
		if (fence) {
			const mark = fence[1] ?? '```';
			const ch = mark.charAt(0);
			out[i] = LineClass.Code;
			let j = i + 1;
			for (; j < lines.length; j++) {
				out[j] = LineClass.Code;
				const t = (lines[j] ?? '').trim();
				if (t.length >= mark.length && t.split('').every((c) => c === ch)) break;
			}
			i = j;
			continue;
		}
		const t = line.trim();
		if (t.startsWith('$$')) {
			out[i] = LineClass.Math;
			// A one-line block: $$x$$.
			if (t.length > 4 && t.endsWith('$$')) continue;
			let j = i + 1;
			for (; j < lines.length; j++) {
				out[j] = LineClass.Math;
				if ((lines[j] ?? '').trim().endsWith('$$')) break;
			}
			i = j;
		}
	}
	return out;
}

type LineType = 'blank' | 'heading' | 'list' | 'quote' | 'table' | 'plain';

function lineType(line: string): LineType {
	if (line.trim() === '') return 'blank';
	if (HEADING.test(line)) return 'heading';
	if (QUOTE.test(line)) return 'quote';
	if (TABLE.test(line)) return 'table';
	if (LIST.test(line)) return 'list';
	return 'plain';
}

/** Heading text as Obsidian stores it: no hashes, no closing hashes, trimmed. */
export function headingText(line: string): string | null {
	const m = HEADING.exec(bare(line));
	if (!m) return null;
	const text = (m[2] ?? '').replace(/[ \t]+#+$/, '').trim();
	return text === '' || /^#+$/.test(text) ? null : text;
}

/**
 * Finds the block that holds `line` (0-based).
 * A list item is its own line plus its lazy continuation lines; child items are other blocks.
 * A quote, a callout and a table are one block each. Code, math, front matter and empty lines are refused.
 */
export function findBlock(rawLines: readonly string[], line: number, classes?: Uint8Array): BlockResult {
	const lines = rawLines.map(bare);
	const cls = classes ?? classifyLines(rawLines);
	if (line < 0 || line >= lines.length) return { kind: 'empty', refused: true };
	const c = cls[line];
	if (c === LineClass.Frontmatter) return { kind: 'frontmatter', refused: true };
	if (c === LineClass.Code) return { kind: 'code', refused: true };
	if (c === LineClass.Math) return { kind: 'math', refused: true };
	const text = lines[line] ?? '';
	const type = lineType(text);
	if (type === 'blank') return { kind: 'empty', refused: true };
	const isText = (i: number) => i >= 0 && i < lines.length && cls[i] === LineClass.Text;

	if (type === 'heading') {
		const heading = headingText(text);
		if (heading === null) return { kind: 'empty', refused: true };
		return { kind: 'heading', start: line, end: line, id: null, heading };
	}

	if (type === 'quote' || type === 'table') {
		let start = line;
		while (isText(start - 1) && lineType(lines[start - 1] ?? '') === type) start--;
		let end = line;
		while (isText(end + 1) && lineType(lines[end + 1] ?? '') === type) end++;
		const kind: BlockKind = type === 'table' ? 'table' : CALLOUT.test(lines[start] ?? '') ? 'callout' : 'quote';
		return { kind, start, end, id: structuredId(lines, end), heading: null };
	}

	if (ID_LINE.test(text)) {
		// A lone id line after a table or a quote belongs to that block. Obsidian links it to the block above.
		const above = line >= 2 && (lines[line - 1] ?? '').trim() === '' ? lineType(lines[line - 2] ?? '') : 'blank';
		if (above === 'table' || above === 'quote') return { kind: 'id-line', refused: true };
	}

	// List item or paragraph. Walk up over plain lines to the start.
	let start = line;
	if (type === 'plain') {
		while (isText(start - 1) && lineType(lines[start - 1] ?? '') === 'plain') start--;
		if (isText(start - 1) && lineType(lines[start - 1] ?? '') === 'list') start--;
	}
	let end = start;
	while (isText(end + 1) && lineType(lines[end + 1] ?? '') === 'plain') end++;
	const first = lines[start] ?? '';
	const kind: BlockKind = LIST.test(first) ? (TASK.test(first) ? 'task' : 'list') : 'paragraph';
	const m = END_ID.exec(lines[end] ?? '');
	return { kind, start, end, id: m ? (m[1] ?? null) : null, heading: null };
}

/** The id of a table or a quote: on the next line, or on the line after one blank line. */
function structuredId(lines: readonly string[], end: number): string | null {
	const next = lines[end + 1];
	if (next === undefined) return null;
	const direct = ID_LINE.exec(next);
	if (direct) return direct[1] ?? null;
	if (next.trim() !== '') return null;
	const after = ID_LINE.exec(lines[end + 2] ?? '');
	return after ? (after[1] ?? null) : null;
}

/** Every block id in the note text, in lower case (Obsidian matches ids without case). */
export function collectIds(text: string): string[] {
	const out = new Set<string>();
	for (const m of text.matchAll(/(?:^|\s)\^([A-Za-z0-9-]+)[ \t]*\r?$/gm)) out.add((m[1] ?? '').toLowerCase());
	return [...out];
}

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A new random id of 6 characters a-z and 0-9, as core makes. It is not in `taken` (compared without case). */
export function newBlockId(taken: readonly string[], rand: () => number = Math.random): string {
	const used = new Set(taken.map((t) => t.toLowerCase()));
	for (let attempt = 0; attempt < 1000; attempt++) {
		let id = '';
		for (let i = 0; i < 6; i++) id += ID_CHARS.charAt(Math.floor(rand() * ID_CHARS.length) % ID_CHARS.length);
		if (!used.has(id)) return id;
	}
	// 36^6 ids: this line runs only with a broken random source.
	let n = 0;
	while (used.has(`id-${n}`)) n++;
	return `id-${n}`;
}

/**
 * Pro: a readable id from the first three words of the block text, for example ^call-bob.
 * Returns null when the text has no letters or digits. Adds -2, -3 and so on when the id is taken.
 */
export function readableBlockId(blockText: string, taken: readonly string[]): string | null {
	const used = new Set(taken.map((t) => t.toLowerCase()));
	const text = bare(blockText.split('\n')[0] ?? '')
		.replace(/^\s*(?:>\s*)*(?:\[![^\]]*\][+-]?\s*)?/, '')
		.replace(/^\s*(?:[-*+]|\d{1,9}[.)])\s+(?:\[.\]\s+)?/, '')
		.replace(/^#{1,6}\s+/, '')
		.replace(END_ID, '')
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '');
	const words = text.match(/[a-z0-9]+/g) ?? [];
	let base = words.slice(0, 3).join('-').slice(0, 24).replace(/-+$/, '');
	if (base === '') return null;
	if (/^\d+$/.test(base)) base = `b-${base}`;
	if (!used.has(base)) return base;
	for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

export interface Insertion {
	/** 0-based line; the text goes at the end of this line. */
	line: number;
	text: string;
}

/**
 * Where the new id goes and what to insert.
 * Paragraph, list item and task: " ^id" at the end of the last line.
 * Quote, callout and table: the id on its own line, with a blank line before it and after it.
 * Returns null for a heading or a block that has an id.
 */
export function idInsertion(rawLines: readonly string[], block: Block, id: string, eol = '\n'): Insertion | null {
	if (block.kind === 'heading' || block.id !== null) return null;
	const last = bare(rawLines[block.end] ?? '');
	if (block.kind === 'quote' || block.kind === 'callout' || block.kind === 'table') {
		const next = rawLines[block.end + 1];
		const tail = next !== undefined && bare(next).trim() !== '' ? eol : '';
		return { line: block.end, text: `${eol}${eol}^${id}${tail}` };
	}
	return { line: block.end, text: `${/\s$/.test(last) || last === '' ? '' : ' '}^${id}` };
}

/** Applies an insertion to the note text. Every other byte stays the same. Keeps CRLF line ends. */
export function applyInsertion(text: string, ins: Insertion): string {
	let offset = 0;
	for (let i = 0; i < ins.line; i++) {
		const nl = text.indexOf('\n', offset);
		if (nl < 0) return text;
		offset = nl + 1;
	}
	let end = text.indexOf('\n', offset);
	if (end < 0) end = text.length;
	if (end > offset && text.charAt(end - 1) === '\r') end--;
	return text.slice(0, end) + ins.text + text.slice(end);
}

/**
 * The link subpath of a heading, by the core rule: the characters : # | ^ \ and the pairs %%, [[ and ]]
 * become a space, and runs of spaces become one space.
 */
export function headingSubpath(heading: string): string {
	return heading
		.replace(/([:#|^\\\r\n]|%%|\[\[|]])/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** The subpath (with #) of a block for a link: #Heading or #^id. */
export function subpathFor(block: Block, id: string | null): string {
	if (block.kind === 'heading') return `#${headingSubpath(block.heading ?? '')}`;
	return `#^${id ?? block.id ?? ''}`;
}

/**
 * Link text for a drop. `generated` is the link that Obsidian made for the source note with this subpath
 * (fileManager.generateMarkdownLink), so the user's link format applies.
 * In the same note, the link has no note name: [[#Heading]], or [Heading](#Heading) in Markdown link format.
 */
export function buildLink(generated: string, subpath: string, sameNote: boolean, embed: boolean): string {
	let link = generated;
	if (sameNote) {
		if (generated.startsWith('[[')) link = `[[${subpath}]]`;
		else {
			const label = subpath.replace(/^#\^?/, '');
			const target = '#' + encodeURI(subpath.slice(1)).replace(/%5E/g, '^');
			link = `[${label.replace(/([[\]])/g, '\\$1')}](${target})`;
		}
	}
	return embed && !link.startsWith('!') ? `!${link}` : link;
}

/**
 * Pro: the blocks between two lines (inclusive), in order, each one time. Refused lines are skipped.
 */
export function blocksInRange(rawLines: readonly string[], from: number, to: number, classes?: Uint8Array): Block[] {
	const cls = classes ?? classifyLines(rawLines);
	const out: Block[] = [];
	let line = Math.max(0, Math.min(from, to));
	const last = Math.min(rawLines.length - 1, Math.max(from, to));
	while (line <= last) {
		const b = findBlock(rawLines, line, cls);
		if (isRefusal(b)) {
			line++;
			continue;
		}
		if (!out.some((o) => o.start === b.start)) out.push(b);
		line = Math.max(line, b.end) + 1;
	}
	return out;
}
