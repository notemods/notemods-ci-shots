// Pure outline logic: no Obsidian import, so vitest and the golden vectors run it as is.
// The plugin feeds it note data from the metadata cache (src/source.ts); the tests feed it a small scanner.
import { countWords, readableText } from './core/index';

export interface HeadingInfo {
	text: string;
	level: number;
	line: number;
}

export interface EmbedInfo {
	/** The link part of the embed, without the display text: "Note", "Note#Heading", "#Heading" or "Note#^id". */
	link: string;
	line: number;
}

export interface CalloutInfo {
	line: number;
	type: string;
	title: string;
}

export interface ListHeadingInfo {
	line: number;
	level: number;
	text: string;
}

export interface NoteData {
	path: string;
	lines: string[];
	headings: HeadingInfo[];
	embeds: EmbedInfo[];
	callouts: CalloutInfo[];
	listHeadings: ListHeadingInfo[];
}

/**
 * Where an embed points. `start` and `end` are line numbers in the target note, end exclusive.
 *   note: a Markdown note, the whole note or one heading or block section of it
 *   file: an image, PDF, canvas or other file with no headings (left out of the outline)
 *   missing-note: no file with that name
 *   missing-sub: the note exists, the heading or block ID does not
 */
export type Target =
	| { kind: 'note'; path: string; start: number; end: number; sub: 'none' | 'heading' | 'block' }
	| { kind: 'file' }
	| { kind: 'missing-note' }
	| { kind: 'missing-sub'; path: string; sub: 'heading' | 'block' };

export interface OutlineSource {
	/** The source stopped reading new notes at its limit. */
	truncated?: boolean;
	note(path: string): NoteData | null;
	resolve(link: string, fromPath: string): Target;
}

export interface OutlineOptions {
	/** Callout titles as outline rows. */
	callouts: boolean;
	/** Headings written inside list items ("- ## Idea") as outline rows. */
	listHeadings: boolean;
	/** How many levels of embeds to open: 1 = the embeds in the note itself. Free 1, Pro up to MAX_DEPTH. */
	maxDepth: number;
	/** Word count for each heading and embed and for the whole note (Pro). */
	words: boolean;
	/** Rows for embeds whose note, heading or block does not exist, and for embeds that embed themselves (Pro). */
	broken: boolean;
}

export const MAX_DEPTH = 5;
/** Upper bound on rows, so a vault of notes that embed each other cannot freeze the panel. */
export const MAX_ITEMS = 5000;
/** Upper bound on embedded parts that the word counts read, so notes that embed each other cannot freeze the panel. */
export const MAX_WORD_STEPS = 20000;

export type ItemKind = 'heading' | 'callout' | 'list-heading' | 'embed' | 'broken' | 'cycle';

export interface OutlineItem {
	kind: ItemKind;
	/** Plain text of the row: heading text, callout title, or the embed link. */
	text: string;
	/** The note that holds this row (for an embed row: the embedded note; for a broken row: the note with the embed). */
	path: string;
	/** Line of the row in `path`. For an embed row: the first line of the embedded part. */
	line: number;
	/** Line in the open note to scroll to: the row's own line, or the line of the top-level embed that shows it. */
	rootLine: number;
	/** Heading rows: the heading as written in the note, for links. */
	heading?: string;
	/** Heading level 1-6; 0 for other rows. */
	level: number;
	/** 0 = the open note, 1 = a note embedded in it, and so on. */
	depth: number;
	/** Embed rows: the embed link as written. Broken and cycle rows: the link that failed. */
	link?: string;
	/** Callout rows: the callout type in lower case. */
	calloutType?: string;
	/** Broken rows: what is missing. */
	missing?: 'note' | 'heading' | 'block';
	/** Embed rows past the depth limit: shown without children. */
	locked?: boolean;
	/** Words in this heading's section or this embed, embedded text included (only when options.words). */
	words?: number;
	children: OutlineItem[];
}

export interface Outline {
	path: string;
	items: OutlineItem[];
	/** Words in the whole note, embedded text included (only when options.words). */
	words?: number;
	/** Embed rows with children or locked. */
	embeds: number;
	/** Broken and cycle rows (only when options.broken). */
	broken: number;
	/** Embed rows past the depth limit. */
	locked: number;
	/** Every note the outline read, for live updates. */
	paths: string[];
	/** True when MAX_ITEMS stopped the build or MAX_WORD_STEPS stopped a word count. */
	truncated: boolean;
}

const CALLOUT = /^\s{0,3}(?:>\s?)+\[!([^\]\s]+)\]([+-]?)\s*(.*)$/;
const CALLOUT_MARK = /^(\s{0,3}(?:>\s?)+)\[![^\]\s]+\][+-]?/;
const LIST_HEADING = /^\s*(?:[-*+]|\d{1,9}[.)])\s+(?:\[.\]\s+)?(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;

/** Callout type and title from the first line of a callout, or null. An empty title shows the type, as the app does. */
export function calloutAt(text: string): { type: string; title: string } | null {
	const m = CALLOUT.exec(text);
	if (!m) return null;
	const type = m[1]!.toLowerCase();
	const title = plainInline(m[3] ?? '').trim();
	return { type, title: title || type.charAt(0).toUpperCase() + type.slice(1) };
}

/** A heading written inside a list item ("- ## Idea"), or null. */
export function listHeadingAt(text: string): { level: number; text: string } | null {
	const m = LIST_HEADING.exec(text);
	if (!m) return null;
	const t = plainInline(m[2] ?? '').trim();
	return t ? { level: m[1]!.length, text: t } : null;
}

/** Inline Markdown as the plain text a reader sees: link text, no emphasis marks, no code ticks. */
export function plainInline(text: string): string {
	return text
		.replace(/!?\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
		.replace(/!?\[\[([^\]]*)\]\]/g, (_m, t: string) => t.replace(/#\^?/g, ' > ').replace(/^ > /, ''))
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/`([^`]*)`/g, '$1')
		.replace(/(\*\*|__|==|~~)(.+?)\1/g, '$2')
		.replace(/(^|[^\w*])[*_]([^*_\s][^*_]*?)[*_](?=[^\w*]|$)/g, '$1$2')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Words in lines [start, end) of a note, embeds not included. Chinese and Japanese characters count one each. */
export function wordsIn(lines: readonly string[], start: number, end: number): number {
	if (end <= start) return 0;
	// The [!type] marker of a callout is syntax, not a word.
	const text = lines
		.slice(Math.max(0, start), Math.min(lines.length, end))
		.map((l) => l.replace(CALLOUT_MARK, '$1'))
		.join('\n');
	const { words, cjkChars } = countWords(readableText(text));
	return words + cjkChars;
}

interface Entry {
	line: number;
	order: number;
	kind: 'heading' | 'callout' | 'list-heading' | 'embed';
	heading?: HeadingInfo;
	callout?: CalloutInfo;
	listHeading?: ListHeadingInfo;
	embed?: EmbedInfo;
}

/** End line (exclusive) of the section of heading i: the next heading of the same or a higher level, or the end. */
export function sectionEnd(note: NoteData, i: number, limit = note.lines.length): number {
	const h = note.headings[i]!;
	for (let j = i + 1; j < note.headings.length; j++) {
		const n = note.headings[j]!;
		if (n.line >= limit) break;
		if (n.level <= h.level) return n.line;
	}
	return limit;
}

/** One embedded part of a note. Two parts with the same start line and a different end are different parts. */
function partKey(path: string, start: number, end: number): string {
	return `${path}#${start}-${end}`;
}

class Builder {
	readonly paths = new Set<string>();
	count = 0;
	embeds = 0;
	broken = 0;
	locked = 0;
	truncated = false;
	private wordSteps = 0;
	private readonly wordMemo = new Map<string, number>();

	constructor(
		private readonly src: OutlineSource,
		private readonly opts: OutlineOptions,
		private readonly depthLimit: number,
	) {}

	/** Rows for lines [start, end) of a note. `anchor` is the root line of the top-level embed, or null in the open note. */
	range(note: NoteData, start: number, end: number, depth: number, anchor: number | null, chain: readonly string[]): OutlineItem[] {
		this.paths.add(note.path);
		const entries = this.entries(note, start, end);
		const top: OutlineItem[] = [];
		const stack: OutlineItem[] = [];
		const parent = (): OutlineItem[] => stack[stack.length - 1]?.children ?? top;
		for (const e of entries) {
			if (this.count >= MAX_ITEMS) {
				this.truncated = true;
				break;
			}
			const rootLine = anchor ?? e.line;
			if (e.kind === 'heading') {
				const h = e.heading!;
				while (stack.length > 0 && stack[stack.length - 1]!.level >= h.level) stack.pop();
				const item = this.item({ kind: 'heading', text: plainInline(h.text), path: note.path, line: h.line, rootLine, level: h.level, depth, heading: h.text });
				if (this.opts.words) {
					const idx = note.headings.indexOf(h);
					item.words = this.words(note, h.line, sectionEnd(note, idx, end), depth, chain);
				}
				parent().push(item);
				stack.push(item);
			} else if (e.kind === 'callout') {
				const c = e.callout!;
				parent().push(this.item({ kind: 'callout', text: c.title, path: note.path, line: c.line, rootLine, level: 0, depth, calloutType: c.type }));
			} else if (e.kind === 'list-heading') {
				const l = e.listHeading!;
				parent().push(this.item({ kind: 'list-heading', text: l.text, path: note.path, line: l.line, rootLine, level: l.level, depth }));
			} else {
				const row = this.embed(note, e.embed!, depth, anchor, chain);
				if (row) parent().push(row);
			}
		}
		return top;
	}

	private entries(note: NoteData, start: number, end: number): Entry[] {
		const inRange = (line: number): boolean => line >= start && line < end;
		const out: Entry[] = [];
		for (const h of note.headings) if (inRange(h.line)) out.push({ line: h.line, order: 0, kind: 'heading', heading: h });
		if (this.opts.callouts) for (const c of note.callouts) if (inRange(c.line)) out.push({ line: c.line, order: 1, kind: 'callout', callout: c });
		if (this.opts.listHeadings) for (const l of note.listHeadings) if (inRange(l.line)) out.push({ line: l.line, order: 2, kind: 'list-heading', listHeading: l });
		for (const m of note.embeds) if (inRange(m.line)) out.push({ line: m.line, order: 3, kind: 'embed', embed: m });
		// A callout that starts with an embed ("> ![[Note]]") lists the callout first, then the embed.
		return out.sort((a, b) => a.line - b.line || a.order - b.order);
	}

	private item(base: Omit<OutlineItem, 'children'>): OutlineItem {
		this.count++;
		return { ...base, children: [] };
	}

	private embed(note: NoteData, e: EmbedInfo, depth: number, anchor: number | null, chain: readonly string[]): OutlineItem | null {
		const t = this.src.resolve(e.link, note.path);
		const rootLine = anchor ?? e.line;
		if (t.kind === 'file') return null;
		if (t.kind === 'missing-note' || t.kind === 'missing-sub') {
			if (!this.opts.broken) return null;
			this.broken++;
			const missing = t.kind === 'missing-note' ? 'note' : t.sub;
			return this.item({ kind: 'broken', text: plainInline(`[[${e.link}]]`), path: note.path, line: e.line, rootLine, level: 0, depth, link: e.link, missing });
		}
		const key = partKey(t.path, t.start, t.end);
		// The chain holds the open note and every embed above this one: meeting one of them again is a loop.
		if (chain.includes(key)) {
			if (!this.opts.broken) return null;
			this.broken++;
			return this.item({ kind: 'cycle', text: plainInline(`[[${e.link}]]`), path: note.path, line: e.line, rootLine, level: 0, depth, link: e.link });
		}
		const row = this.item({ kind: 'embed', text: plainInline(`[[${e.link}]]`), path: t.path, line: t.start, rootLine, level: 0, depth: depth + 1, link: e.link });
		this.embeds++;
		if (depth + 1 > this.depthLimit) {
			row.locked = true;
			this.locked++;
			return row;
		}
		const target = this.src.note(t.path);
		if (!target) return row;
		this.paths.add(t.path);
		if (this.opts.words) row.words = this.words(target, t.start, t.end, depth + 1, [...chain, key]);
		row.children = this.range(target, t.start, t.end, depth + 1, rootLine, [...chain, key]);
		return row;
	}

	/** Words in lines [start, end) of a note plus the words of the embeds in it, down to the depth limit. */
	words(note: NoteData, start: number, end: number, depth: number, chain: readonly string[]): number {
		const memoKey = `${note.path}|${start}|${end}|${depth}|${chain.join(',')}`;
		const hit = this.wordMemo.get(memoKey);
		if (hit !== undefined) return hit;
		let total = wordsIn(note.lines, start, end);
		if (++this.wordSteps > MAX_WORD_STEPS) {
			this.truncated = true;
			return total;
		}
		for (const m of note.embeds) {
			if (m.line < start || m.line >= end) continue;
			const t = this.src.resolve(m.link, note.path);
			if (t.kind !== 'note' || depth + 1 > this.depthLimit) continue;
			const key = partKey(t.path, t.start, t.end);
			if (chain.includes(key)) continue;
			const target = this.src.note(t.path);
			if (target) total += this.words(target, t.start, t.end, depth + 1, [...chain, key]);
		}
		this.wordMemo.set(memoKey, total);
		return total;
	}
}

/** The outline of one note: its headings, callouts and embeds, with the headings of each embedded part nested under it. */
export function buildOutline(rootPath: string, src: OutlineSource, opts: OutlineOptions): Outline {
	const depthLimit = Math.max(1, Math.min(MAX_DEPTH, Math.floor(opts.maxDepth) || 1));
	const b = new Builder(src, opts, depthLimit);
	const root = src.note(rootPath);
	if (!root) return { path: rootPath, items: [], embeds: 0, broken: 0, locked: 0, paths: [rootPath], truncated: false };
	const chain = [partKey(rootPath, 0, root.lines.length)];
	const items = b.range(root, 0, root.lines.length, 0, null, chain);
	const out: Outline = { path: rootPath, items, embeds: b.embeds, broken: b.broken, locked: b.locked, paths: [...b.paths], truncated: b.truncated || src.truncated === true };
	if (opts.words) {
		out.words = b.words(root, 0, root.lines.length, 0, chain);
		out.truncated = b.truncated || src.truncated === true;
	}
	return out;
}

/** Keep rows whose label contains the query and their parents. Do not change the source tree. */
export function filterOutline(
	items: readonly OutlineItem[],
	query: string,
	label: (row: OutlineItem) => string = (row) => row.text,
): { items: OutlineItem[]; matches: number } {
	const needle = query.trim().normalize('NFC').toLowerCase();
	if (!needle) return { items: [...items], matches: 0 };
	let matches = 0;
	const walk = (rows: readonly OutlineItem[]): OutlineItem[] => {
		const kept: OutlineItem[] = [];
		for (const row of rows) {
			const children = walk(row.children);
			const match = label(row).normalize('NFC').toLowerCase().includes(needle);
			if (match) matches++;
			if (match || children.length) kept.push({ ...row, children });
		}
		return kept;
	};
	return { items: walk(items), matches };
}

const KIND_MARK: Record<ItemKind, string> = {
	heading: 'H',
	callout: 'C',
	'list-heading': 'L',
	embed: 'E',
	broken: '!',
	cycle: '@',
};

/** One text line per row, indented two spaces per level, for tests and the golden vectors. */
export function outlineLines(items: readonly OutlineItem[], indent = 0): string[] {
	const out: string[] = [];
	for (const it of items) {
		const level = it.kind === 'heading' || it.kind === 'list-heading' ? String(it.level) : '';
		const extra = [
			it.calloutType ? `[${it.calloutType}]` : '',
			it.missing ? `missing ${it.missing}` : '',
			it.locked ? 'locked' : '',
			it.words !== undefined ? `${it.words}w` : '',
			`@${it.rootLine}`,
		]
			.filter(Boolean)
			.join(' ');
		out.push(`${'  '.repeat(indent)}${KIND_MARK[it.kind]}${level} ${it.text} ${extra}`);
		out.push(...outlineLines(it.children, indent + 1));
	}
	return out;
}

/** Characters that cannot stand in the heading part of a wikilink; the app writes a space for each. */
const LINK_UNSAFE = /[#|^\\%[\]:]/g;

export interface MarkdownListOptions {
	/** Link text of a note path from the open note, as the app writes it (fileToLinktext). */
	linkText: (path: string) => string;
	words: boolean;
}

/** The outline as a nested Markdown list with a wikilink to each heading, for pasting into a note (Pro). */
export function toMarkdownList(outline: Outline, opts: MarkdownListOptions): string {
	const lines: string[] = [];
	const walk = (items: readonly OutlineItem[], indent: number): void => {
		for (const it of items) {
			const pad = '\t'.repeat(indent);
			const count = opts.words && it.words !== undefined ? ` (${it.words.toLocaleString('en-US')} words)` : '';
			if (it.kind === 'heading') {
				const target = (it.heading ?? it.text).replace(LINK_UNSAFE, ' ').replace(/\s+/g, ' ').trim();
				lines.push(`${pad}- [[${opts.linkText(it.path)}#${target}|${it.text.replace(/[|\]]/g, ' ').trim()}]]${count}`);
			} else if (it.kind === 'embed') {
				const hash = it.link?.indexOf('#') ?? -1;
				const subpath = hash < 0 ? '' : it.link!.slice(hash);
				lines.push(`${pad}- [[${opts.linkText(it.path)}${subpath}]]${count}`);
			} else if (it.kind === 'callout') {
				lines.push(`${pad}- ${it.calloutType ?? 'note'}: ${it.text}`);
			} else if (it.kind === 'list-heading') {
				lines.push(`${pad}- ${it.text}`);
			} else {
				lines.push(`${pad}- ${it.kind === 'cycle' ? 'Embeds itself' : `Missing ${it.missing ?? 'note'}`}: \`${it.link ?? ''}\``);
			}
			walk(it.children, indent + 1);
		}
	};
	walk(outline.items, 0);
	return lines.join('\n') + (lines.length ? '\n' : '');
}
