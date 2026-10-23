// Pure logic: find block embeds in a line, select the ones to draw inline, and make the inline text of a block.
// No Obsidian imports, so the golden vectors (packages/spec/vectors/inline-block-embeds.json) test it directly.

/** Inline embeds in inline embeds stop at this depth. The next level shows its link text. */
export const MAX_DEPTH = 3;

/** One `![[target#^id]]` or `![[target#^id|alias]]` in a line. Offsets are in the line. */
export interface EmbedMatch {
	from: number;
	to: number;
	/** The link without the alias, for example `Source#^p1`. */
	linktext: string;
	/** The note part of the link. Empty for a block in the same note. */
	path: string;
	blockId: string;
	alias: string | null;
	/** The alias, or the link text when there is no alias. */
	display: string;
	/** True when the embed is drawn inline (rule 2, or rule 3 with "Draw every block embed inline"). */
	selected: boolean;
}

/** The kind of a block. Only paragraphs and list items are drawn inline. */
export type BlockKind = 'paragraph' | 'listItem' | 'heading' | 'table' | 'code' | 'math' | 'callout' | 'blockquote' | 'list' | 'other';

export interface InlineResult {
	/** inline: draw the text in the line. native: leave the embed as Obsidian draws it. missing: no such block. */
	state: 'inline' | 'native' | 'missing';
	kind: BlockKind | null;
	text: string;
}

export type LineKind = 'text' | 'code' | 'frontmatter' | 'math' | 'table' | 'callout';

const EMBED_RE = /!\[\[([^[\]|#\n]*)#\^([A-Za-z0-9-]+)(?:\|([^[\]\n]*))?\]\]/g;
const LIST_MARK_RE = /^\s*(?:[-*+]|\d+[.)])(?:\s+|$)(?:\[.\](?:\s+|$))?/;
const LINE_PREFIX_RE = /^\s*(?:>\s*)*(?:#{1,6}\s+)?(?:(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?)?/;
const FENCE_RE = /^\s*(`{3,}|~{3,})/;
const TABLE_DELIM_RE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const HEADING_RE = /^\s{0,3}#{1,6}(?:\s|$)/;

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Ranges of inline code spans in a line, as [from, to) pairs. */
export function codeSpans(line: string): Array<[number, number]> {
	const out: Array<[number, number]> = [];
	let i = 0;
	while (i < line.length) {
		if (line[i] !== '`' || (i > 0 && line[i - 1] === '\\')) {
			i++;
			continue;
		}
		let n = 0;
		while (line[i + n] === '`') n++;
		const fence = '`'.repeat(n);
		let j = line.indexOf(fence, i + n);
		while (j !== -1 && line[j + n] === '`') {
			let k = j;
			while (line[k] === '`') k++;
			j = line.indexOf(fence, k);
		}
		if (j === -1) {
			i += n;
			continue;
		}
		out.push([i, j + n]);
		i = j + n;
	}
	return out;
}

/** Every block embed in one line, in order, with the inline choice of rules 2 and 3. */
export function selectEmbeds(line: string, drawAll = false): EmbedMatch[] {
	const spans = codeSpans(line);
	const found: EmbedMatch[] = [];
	for (const m of line.matchAll(EMBED_RE)) {
		const from = m.index;
		const to = from + m[0].length;
		if (from > 0 && line[from - 1] === '\\') continue;
		if (spans.some(([a, b]) => from < b && to > a)) continue;
		const path = (m[1] ?? '').trim();
		const blockId = m[2] ?? '';
		const alias = m[3] !== undefined && m[3].trim() !== '' ? m[3].trim() : null;
		const linktext = `${path}#^${blockId}`;
		found.push({ from, to, linktext, path, blockId, alias, display: alias ?? linktext, selected: false });
	}
	for (const e of found) {
		const before = line.slice(0, e.from).replace(LINE_PREFIX_RE, '');
		const after = line.slice(e.to);
		e.selected = drawAll || (before + after).trim() !== '';
	}
	return found;
}

/** The kind of each line of a note: front matter, fenced code, math, table and callout lines are not plain text. */
export function classifyLines(lines: string[]): LineKind[] {
	const kinds: LineKind[] = lines.map(() => 'text');
	let i = 0;
	if (lines[0] === '---') {
		let end = 1;
		while (end < lines.length && lines[end] !== '---' && lines[end] !== '...') end++;
		if (end < lines.length) {
			for (let k = 0; k <= end; k++) kinds[k] = 'frontmatter';
			i = end + 1;
		}
	}
	while (i < lines.length) {
		const line = lines[i] ?? '';
		const fence = FENCE_RE.exec(line);
		if (fence) {
			const mark = fence[1] ?? '```';
			const close = new RegExp(`^\\s*${escapeRe(mark[0] ?? '`')}{${mark.length},}\\s*$`);
			kinds[i] = 'code';
			i++;
			while (i < lines.length) {
				kinds[i] = 'code';
				if (close.test(lines[i] ?? '')) break;
				i++;
			}
			i++;
			continue;
		}
		if (line.trim().startsWith('$$')) {
			const rest = line.trim().slice(2);
			kinds[i] = 'math';
			if (rest.includes('$$')) {
				i++;
				continue;
			}
			i++;
			while (i < lines.length) {
				kinds[i] = 'math';
				if ((lines[i] ?? '').includes('$$')) break;
				i++;
			}
			i++;
			continue;
		}
		if (/^\s*>/.test(line)) {
			const callout = /^\s*>\s*\[![^\]]+\]/.test(line);
			while (i < lines.length && /^\s*>/.test(lines[i] ?? '')) {
				if (callout) kinds[i] = 'callout';
				i++;
			}
			continue;
		}
		if (line.includes('|') && TABLE_DELIM_RE.test(lines[i + 1] ?? '') && (lines[i + 1] ?? '').includes('-')) {
			while (i < lines.length && (lines[i] ?? '').includes('|') && (lines[i] ?? '').trim() !== '') {
				kinds[i] = 'table';
				i++;
			}
			continue;
		}
		i++;
	}
	return kinds;
}

/** Removes the `^id` marker, and for a list item the list marker and the task box. Joins lines with a space. */
export function cleanBlock(raw: string, blockId: string, kind: BlockKind): string {
	let lines = raw.replace(/\r/g, '').split('\n');
	const marker = new RegExp(`(?:^|\\s+)\\^${escapeRe(blockId)}\\s*$`);
	for (let k = lines.length - 1; k >= 0; k--) {
		if ((lines[k] ?? '').trim() === '') continue;
		lines[k] = (lines[k] ?? '').replace(marker, '');
		break;
	}
	if (kind === 'listItem' && lines.length) lines[0] = (lines[0] ?? '').replace(LIST_MARK_RE, '');
	lines = lines.map((l) => l.trim()).filter((l) => l !== '');
	return lines.join(' ').trim();
}

/** True for a line that starts a list item. */
export function isListLine(line: string): boolean {
	return /^\s*(?:[-*+]|\d+[.)])(?:\s|$)/.test(line);
}

/** Pure locator: finds the block with this id in note text, as Obsidian does, and gives its kind and raw lines. */
export function locateBlock(source: string, blockId: string): { kind: BlockKind; raw: string } | null {
	const lines = source.replace(/\r/g, '').split('\n');
	const kinds = classifyLines(lines);
	const idRe = new RegExp(`(?:^|\\s)\\^${escapeRe(blockId)}\\s*$`);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		if (!idRe.test(line)) continue;
		const lk = kinds[i];
		if (lk === 'code' || lk === 'frontmatter' || lk === 'math') continue;
		if (lk === 'callout') return { kind: 'callout', raw: line };
		if (line.trim() === `^${blockId}`) {
			// The id on its own line names the block above it.
			let p = i - 1;
			while (p >= 0 && (lines[p] ?? '').trim() === '') p--;
			if (p < 0) return null;
			const pk = kinds[p];
			if (pk === 'table') return { kind: 'table', raw: lines[p] ?? '' };
			if (pk === 'code') return { kind: 'code', raw: lines[p] ?? '' };
			if (pk === 'math') return { kind: 'math', raw: lines[p] ?? '' };
			if (pk === 'callout') return { kind: 'callout', raw: lines[p] ?? '' };
			if (/^\s*>/.test(lines[p] ?? '')) return { kind: 'blockquote', raw: lines[p] ?? '' };
			if (isListLine(lines[p] ?? '') || /^\s+\S/.test(lines[p] ?? '')) return { kind: 'list', raw: lines[p] ?? '' };
			if (HEADING_RE.test(lines[p] ?? '')) return { kind: 'heading', raw: lines[p] ?? '' };
			let s = p;
			while (s > 0 && (lines[s - 1] ?? '').trim() !== '' && kinds[s - 1] === 'text' && !HEADING_RE.test(lines[s - 1] ?? '')) s--;
			return { kind: 'paragraph', raw: lines.slice(s, p + 1).join('\n') };
		}
		if (lk === 'table') return { kind: 'table', raw: line };
		if (HEADING_RE.test(line)) return { kind: 'heading', raw: line };
		if (/^\s*>/.test(line)) return { kind: 'blockquote', raw: line };
		// A list item: walk up over its continuation lines to the line with the list marker.
		let j = i;
		while (j > 0 && !isListLine(lines[j] ?? '') && /^\s+\S/.test(lines[j] ?? '') && (lines[j - 1] ?? '').trim() !== '') j--;
		if (isListLine(lines[j] ?? '')) return { kind: 'listItem', raw: lines.slice(j, i + 1).join('\n') };
		let s = i;
		while (s > 0 && (lines[s - 1] ?? '').trim() !== '' && kinds[s - 1] === 'text' && !HEADING_RE.test(lines[s - 1] ?? '') && !isListLine(lines[s - 1] ?? '') && !/^\s*>/.test(lines[s - 1] ?? '')) s--;
		return { kind: 'paragraph', raw: lines.slice(s, i + 1).join('\n') };
	}
	return null;
}

/** True for a block kind that may be drawn inline. List items need Pro. */
export function isInlineKind(kind: BlockKind | null, listItems = true): boolean {
	return kind === 'paragraph' || (listItems && kind === 'listItem');
}

/** The inline result for a kind and the raw block text. */
export function inlineFromBlock(block: { kind: BlockKind; raw: string } | null, blockId: string, listItems = true): InlineResult {
	if (!block) return { state: 'missing', kind: null, text: '' };
	if (!isInlineKind(block.kind, listItems)) return { state: 'native', kind: block.kind, text: '' };
	return { state: 'inline', kind: block.kind, text: cleanBlock(block.raw, blockId, block.kind) };
}

/** The inline text of block `blockId` in note text `source` (golden vector function). */
export function inlineText(source: string, blockId: string, listItems = true): InlineResult {
	return inlineFromBlock(locateBlock(source, blockId), blockId, listItems);
}

/** The key that names one block for loop checks: the note path and the id. */
export function blockKey(path: string, blockId: string): string {
	return `${path}#^${blockId.toLowerCase()}`;
}

/** Rule 18: inline at depth 1 to 3, a loop or a deeper level shows the link text. */
export function nestState(chain: readonly string[], key: string): 'inline' | 'loop' | 'depth' {
	if (chain.includes(key)) return 'loop';
	if (chain.length >= MAX_DEPTH) return 'depth';
	return 'inline';
}

/**
 * Pure model of the whole draw for golden vectors: the plain text that a reader sees for block `blockId` of note
 * `path`, with each selected inline embed in it expanded. A missing block shows its display text, a loop or a level
 * past MAX_DEPTH shows the link text, and a block that is not drawn inline keeps its `![[...]]` text.
 */
export function expandInline(files: Record<string, string>, path: string, blockId: string, chain: readonly string[] = []): string {
	const key = blockKey(path, blockId);
	const source = files[path];
	if (source === undefined) return `${path}#^${blockId}`;
	const res = inlineText(source, blockId);
	if (res.state !== 'inline') return res.state === 'missing' ? `${path}#^${blockId}` : `![[${path}#^${blockId}]]`;
	const next = [...chain, key];
	let out = '';
	let last = 0;
	for (const e of selectEmbeds(res.text)) {
		if (!e.selected) continue;
		out += res.text.slice(last, e.from);
		const target = e.path === '' ? path : e.path;
		const state = nestState(next, blockKey(target, e.blockId));
		out += state === 'inline' ? expandInline(files, target, e.blockId, next) : e.display;
		last = e.to;
	}
	return out + res.text.slice(last);
}
