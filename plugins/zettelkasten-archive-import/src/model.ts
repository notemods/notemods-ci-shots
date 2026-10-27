import { normalizePath, stringifyYaml } from 'obsidian';
import { parseParts, type Archive, type Note } from './parser';

/** Keyword and file name rules. Free imports use DEFAULT_RULES. Saved rules need Pro. */
export interface Rules {
	fileName: 'number' | 'number-title';
	keywordProperty: string;
	keywordTags: boolean;
}
export const DEFAULT_RULES: Rules = { fileName: 'number', keywordProperty: 'keywords', keywordTags: false };
const RESERVED = ['zkn3_position', 'zkn3_id', 'zkn3_created', 'zkn3_edited', 'title', 'tags', '__proto__', 'constructor', 'prototype'];

export function validateRules(rules: Rules): void {
	if (rules.fileName !== 'number' && rules.fileName !== 'number-title') throw new Error('Select a file name rule.');
	if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/.test(rules.keywordProperty) || RESERVED.includes(rules.keywordProperty.toLowerCase())) throw new Error('Use a keyword property name that starts with a letter and is not a reserved name.');
}
export function normalizeRules(saved: unknown): Rules {
	if (typeof saved !== 'object' || saved === null) return { ...DEFAULT_RULES };
	const row = saved as Partial<Rules>;
	const rules: Rules = {
		fileName: row.fileName === 'number-title' ? 'number-title' : 'number',
		keywordProperty: typeof row.keywordProperty === 'string' ? row.keywordProperty : DEFAULT_RULES.keywordProperty,
		keywordTags: row.keywordTags === true,
	};
	try { validateRules(rules); return rules; } catch { return { ...DEFAULT_RULES }; }
}

export function safeSegment(value: string, limit = 80): string {
	const normalized = Array.from(value.normalize('NFC')).map((c) => c.charCodeAt(0) < 32 ? ' ' : c).join('').replace(/[\\/:*?"<>|[\]#^]/g, '-').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '');
	let s = '';
	let length = 0;
	for (const char of normalized) {
		const size = new TextEncoder().encode(char).length;
		if (length + size > limit) break;
		s += char; length += size;
	}
	return s.replace(/[. ]+$/g, '');
}
export function safeFolder(value: string): string {
	if (!value.trim() || /[\\:*?"<>|]/.test(value) || Array.from(value).some((c) => c.charCodeAt(0) < 32)) throw new Error('Use a relative vault folder path.');
	const path = normalizePath(value.trim());
	if (!path || path === '/' || value.trim().startsWith('/') || path.split('/').some((part) => part === '.' || part === '..' || part.startsWith('.') || part !== safeSegment(part, 120))) throw new Error('Use a relative vault folder path without hidden folders or parent steps.');
	return path;
}
/** The file name without the .md extension. The one-based source position makes it stable. */
export function noteName(note: Pick<Note, 'position' | 'title'>, rules: Rules): string {
	const title = rules.fileName === 'number-title' ? safeSegment(note.title) : '';
	return title ? `${note.position} ${title}` : String(note.position);
}
export function notePath(note: Pick<Note, 'position' | 'title'>, folder: string, rules: Rules): string {
	return normalizePath(`${safeFolder(folder)}/${noteName(note, rules)}.md`);
}
export function tagName(value: string): string {
	const tag = value.trim().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_/-]/gu, '-').replace(/^\/+|\/+$/g, '');
	return /^[\p{N}/-]*$/u.test(tag) ? '' : tag;
}
function label(value: string): string {
	return value.replace(/[[\]|]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Markdown emphasis needs text directly inside the markers, so spaces at the ends go outside them. */
function emphasis(mark: string, inner: string): string {
	const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
	return m?.[2] ? `${m[1] ?? ''}${mark}${m[2]}${mark}${m[3] ?? ''}` : inner;
}

export interface Converted { text: string; missing: number[]; unsupported: string[] }
/** Markup that the import does not convert. The text keeps it unchanged and the report lists it. */
const OTHER_MARKUP = /\[\/?(u|d|sup|sub|font|c|al|ar|ab|color|h|m|l|n|\*|code|img|qm|tc|table|tr|th|td|fn|s|hr)(?=[\] ])/g;

/**
 * Convert the supported Zettelkasten 3 markup: [br], [f] and [b] bold, [k] and [i] italic, [h1] to [h6], [q] and [z n] note links.
 * A link to a deleted or absent slot keeps its source text.
 */
export function convertMarkup(source: string, names: Map<number, string>): Converted {
	const missing: number[] = [];
	let text = source.replace(/\[br\]/g, '\n');
	text = text.replace(/\[(f|b)\]([\s\S]*?)\[\/\1\]/g, (_m, _t: string, inner: string) => emphasis('**', inner));
	text = text.replace(/\[(k|i)\]([\s\S]*?)\[\/\1\]/g, (_m, _t: string, inner: string) => emphasis('*', inner));
	text = text.replace(/\[z ([^[\]]*)\]([\s\S]*?)\[\/z\]/g, (match: string, target: string, inner: string) => {
		const n = /^\s*\d{1,6}\s*$/.test(target) ? Number(target) : NaN;
		const name = names.get(n);
		if (!name) {
			const key = Number.isFinite(n) ? n : 0;
			if (!missing.includes(key)) missing.push(key);
			return match;
		}
		const shown = label(inner);
		return shown ? `[[${name}|${shown}]]` : `[[${name}]]`;
	});
	text = text.replace(/\n?\[h([1-6])\]([\s\S]*?)\[\/h\1\]\n?/g, (_m, level: string, inner: string, offset: number) => `${offset > 0 ? '\n' : ''}${'#'.repeat(Number(level))} ${inner.replace(/\s+/g, ' ').trim()}\n`);
	// Blank lines around the quote stop Markdown from joining the next line to the quote.
	text = text.replace(/\n?\[q\]([\s\S]*?)\[\/q\]\n?/g, (_m, inner: string, offset: number) => `${offset > 0 ? '\n\n' : ''}${inner.trim().split('\n').map((line) => `> ${line}`.trimEnd()).join('\n')}\n\n`);
	const unsupported = [...new Set(Array.from(text.matchAll(OTHER_MARKUP), (m) => m[1] ?? ''))].sort();
	return { text: text.replace(/\s+$/, ''), missing, unsupported };
}

export interface Rendered { path: string; text: string; missing: number[]; unsupported: string[] }
/** Build the Markdown file for one live note. names maps each live position to its file name. */
export function renderNote(note: Note, names: Map<number, string>, folder: string, rules: Rules, titles: Map<number, string> = new Map()): Rendered {
	validateRules(rules);
	const body = convertMarkup(note.content, names);
	const remarks = note.remarks.trim() ? convertMarkup(note.remarks, names) : null;
	const missing = [...body.missing];
	const unsupported = new Set([...body.unsupported, ...(remarks?.unsupported ?? [])]);
	for (const n of remarks?.missing ?? []) if (!missing.includes(n)) missing.push(n);
	const link = (n: number): string => {
		const name = names.get(n);
		const shown = label(titles.get(n) ?? '');
		if (name) return shown && shown !== name ? `[[${name}|${shown}]]` : `[[${name}]]`;
		if (!missing.includes(n)) missing.push(n);
		return `Missing note ${n}`;
	};
	const props: Record<string, unknown> = { zkn3_position: note.position };
	if (note.id) props.zkn3_id = note.id;
	if (note.title.trim()) props.title = note.title;
	if (note.keywords.length) props[rules.keywordProperty] = [...note.keywords];
	if (rules.keywordTags) {
		const tags = [...new Set(note.keywords.map(tagName).filter(Boolean))];
		if (tags.length) props.tags = tags;
	}
	if (note.created) props.zkn3_created = note.created;
	if (note.edited) props.zkn3_edited = note.edited;
	const parts = [`---\n${stringifyYaml(props).trimEnd()}\n---`];
	if (note.title.trim()) parts.push(`# ${note.title.replace(/\s+/g, ' ').trim()}`);
	parts.push(body.text);
	if (note.crossRefs.length) parts.push(`## Cross-references\n\n${note.crossRefs.map((n) => `- ${link(n)}`).join('\n')}`);
	if (note.sequence.length) parts.push(`## Note sequence\n\n${note.sequence.map((n, i) => `${i + 1}. ${link(n)}`).join('\n')}`);
	if (remarks) parts.push(`## Remarks\n\n${remarks.text}`);
	return { path: notePath(note, folder, rules), text: `${parts.join('\n\n')}\n`, missing: missing.sort((a, b) => a - b), unsupported: [...unsupported].sort() };
}
export function titleMap(archive: Archive): Map<number, string> {
	return new Map(archive.notes.map((n) => [n.position, n.title]));
}
export function fileNames(archive: Archive, rules: Rules): Map<number, string> {
	const names = new Map<number, string>();
	const seen = new Set<string>();
	for (const note of archive.notes) {
		const name = noteName(note, rules);
		const key = name.toLowerCase();
		if (seen.has(key)) throw new Error(`Two notes have the same output name: ${name}.`);
		seen.add(key);
		names.set(note.position, name);
	}
	return names;
}

export interface Comparison { added: number[]; changed: number[]; removed: number[]; unchanged: number[] }
function fingerprint(note: Note): string {
	return JSON.stringify([note.id, note.title, note.content, note.keywords, note.crossRefs, note.sequence, note.remarks, note.edited]);
}
/** Compare an earlier archive with a later archive by source position. */
export function compareArchives(earlier: Archive, later: Archive): Comparison {
	const old = new Map(earlier.notes.map((n) => [n.position, fingerprint(n)]));
	const result: Comparison = { added: [], changed: [], removed: [], unchanged: [] };
	const live = new Set<number>();
	for (const note of later.notes) {
		live.add(note.position);
		const before = old.get(note.position);
		if (before === undefined) result.added.push(note.position);
		else if (before === fingerprint(note)) result.unchanged.push(note.position);
		else result.changed.push(note.position);
	}
	result.removed = earlier.notes.map((n) => n.position).filter((n) => !live.has(n));
	return result;
}

/** Golden vector entry: parse the XML parts and render the note at one position, or give the error. */
export function renderXml(meta: string, zkn: string, keywords: string, position: number, folder = 'Import', rules: Rules = DEFAULT_RULES): Rendered | { error: string } {
	try {
		const archive = parseParts(meta, zkn, keywords);
		const note = archive.notes.find((n) => n.position === position);
		if (!note) return { error: `No live note at position ${position}.` };
		return renderNote(note, fileNames(archive, rules), folder, rules, titleMap(archive));
	} catch (e) {
		return { error: e instanceof Error ? e.message : String(e) };
	}
}
/** Golden vector entry: compare two archives given as XML parts. */
export function compareXml(earlier: [string, string, string], later: [string, string, string]): Comparison | { error: string } {
	try { return compareArchives(parseParts(...earlier), parseParts(...later)); } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
}
