// Pure functions (no Obsidian import): find aliased wikilinks in a line, parse the Markdown markup of an alias, and
// plan the Live Preview decorations. Golden vectors: packages/spec/vectors/wikilink-alias-markup.json.

export type StyleType = 'strong' | 'em' | 'del' | 'mark';

export interface TextNode {
	type: 'text';
	from: number;
	to: number;
	text: string;
}

/** A backslash and the punctuation character after it. The reader sees only the character. */
export interface EscapeNode {
	type: 'escape';
	from: number;
	to: number;
	text: string;
}

/** Inline code. open and close are the lengths of the backtick runs. text is the code as the reader sees it. */
export interface CodeNode {
	type: 'code';
	from: number;
	to: number;
	open: number;
	close: number;
	text: string;
}

/** Inline math between single dollar signs (Pro). text is the TeX source. */
export interface MathNode {
	type: 'math';
	from: number;
	to: number;
	text: string;
}

export interface StyleNode {
	type: StyleType;
	from: number;
	to: number;
	open: number;
	close: number;
	children: Inline[];
}

export type Inline = TextNode | EscapeNode | CodeNode | MathNode | StyleNode;

export interface ParseOptions {
	/** Parse `$...$` as math. Off in the free version: then a dollar sign is text, as core shows it. */
	math?: boolean;
}

/** An alias longer than this stays text. It keeps the parse cost of one link small. */
export const MAX_ALIAS = 1000;

interface Delim {
	type: 'delim';
	ch: string;
	from: number;
	count: number;
	orig: number;
	canOpen: boolean;
	canClose: boolean;
}

type Item = Inline | Delim;

const ASCII_PUNCT = /[!-/:-@[-`{-~]/;
const PUNCT = /[\p{P}\p{S}]/u;
const SPACE = /\s/u;

function isSpace(ch: string | undefined): boolean {
	return ch === undefined || ch === '' || SPACE.test(ch);
}

function isPunct(ch: string | undefined): boolean {
	return ch !== undefined && ch !== '' && PUNCT.test(ch);
}

function runLength(src: string, i: number, ch: string): number {
	let n = 0;
	while (src[i + n] === ch) n++;
	return n;
}

/** The text of a code span as CommonMark gives it: one space is cut from each end when both ends have one. */
function codeText(raw: string): string {
	if (raw.length >= 2 && raw.startsWith(' ') && raw.endsWith(' ') && raw.trim() !== '') return raw.slice(1, -1);
	return raw;
}

/** Index of the closing backtick run of exactly n backticks after position i, or -1. */
function closingTicks(src: string, i: number, n: number): number {
	let j = i;
	while (j < src.length) {
		if (src[j] !== '`') {
			j++;
			continue;
		}
		const len = runLength(src, j, '`');
		if (len === n) return j;
		j += len;
	}
	return -1;
}

/** Index of the closing dollar sign of inline math that opens at i, or -1. */
function closingDollar(src: string, i: number): number {
	const first = src[i + 1];
	if (first === undefined || first === '$' || isSpace(first)) return -1;
	for (let j = i + 1; j < src.length; j++) {
		const ch = src[j];
		if (ch === '\\') {
			j++;
			continue;
		}
		if (ch !== '$') continue;
		if (isSpace(src[j - 1])) continue;
		if (/[0-9]/.test(src[j + 1] ?? '')) continue;
		return j;
	}
	return -1;
}

function tokenize(src: string, opts: ParseOptions): Item[] {
	const items: Item[] = [];
	let textFrom = -1;
	const flush = (to: number): void => {
		if (textFrom >= 0 && to > textFrom) items.push({ type: 'text', from: textFrom, to, text: src.slice(textFrom, to) });
		textFrom = -1;
	};
	const text = (i: number): void => {
		if (textFrom < 0) textFrom = i;
	};
	let i = 0;
	while (i < src.length) {
		const ch = src[i]!;
		if (ch === '\\' && i + 1 < src.length && ASCII_PUNCT.test(src[i + 1]!)) {
			flush(i);
			items.push({ type: 'escape', from: i, to: i + 2, text: src[i + 1]! });
			i += 2;
			continue;
		}
		if (ch === '`') {
			const n = runLength(src, i, '`');
			const close = closingTicks(src, i + n, n);
			if (close < 0) {
				text(i);
				i += n;
				continue;
			}
			flush(i);
			items.push({ type: 'code', from: i, to: close + n, open: n, close: n, text: codeText(src.slice(i + n, close)) });
			i = close + n;
			continue;
		}
		if (ch === '$' && opts.math) {
			const close = closingDollar(src, i);
			if (close < 0) {
				text(i);
				i += runLength(src, i, '$');
				continue;
			}
			flush(i);
			items.push({ type: 'math', from: i, to: close + 1, text: src.slice(i + 1, close) });
			i = close + 1;
			continue;
		}
		if (ch === '*' || ch === '_' || ch === '~' || ch === '=') {
			const n = runLength(src, i, ch);
			// Strikethrough and highlight need exactly two characters, as in Obsidian.
			if ((ch === '~' || ch === '=') && n !== 2) {
				text(i);
				i += n;
				continue;
			}
			const before = i > 0 ? src[i - 1] : undefined;
			const after = src[i + n];
			const left = !isSpace(after) && (!isPunct(after) || isSpace(before) || isPunct(before));
			const right = !isSpace(before) && (!isPunct(before) || isSpace(after) || isPunct(after));
			let canOpen = left;
			let canClose = right;
			if (ch === '_') {
				canOpen = left && (!right || isPunct(before));
				canClose = right && (!left || isPunct(after));
			}
			flush(i);
			items.push({ type: 'delim', ch, from: i, count: n, orig: n, canOpen, canClose });
			i += n;
			continue;
		}
		text(i);
		i++;
	}
	flush(src.length);
	return items;
}

const STYLE_OF: Record<string, StyleType> = { '~': 'del', '=': 'mark' };

/** The CommonMark "process emphasis" step over a flat item list. Matched pairs become style nodes. */
function processEmphasis(items: Item[]): void {
	for (let c = 0; c < items.length; c++) {
		const closer = items[c]!;
		if (closer.type !== 'delim' || !closer.canClose || closer.count === 0) continue;
		let found = -1;
		for (let o = c - 1; o >= 0; o--) {
			const op = items[o]!;
			if (op.type !== 'delim' || op.ch !== closer.ch || !op.canOpen || op.count === 0) continue;
			const star = op.ch === '*' || op.ch === '_';
			if (star && (op.canClose || closer.canOpen) && (op.orig + closer.orig) % 3 === 0 && !(op.orig % 3 === 0 && closer.orig % 3 === 0)) continue;
			found = o;
			break;
		}
		if (found < 0) continue;
		const op = items[found] as Delim;
		const star = op.ch === '*' || op.ch === '_';
		const use = !star ? 2 : op.count >= 2 && closer.count >= 2 ? 2 : 1;
		const type: StyleType = STYLE_OF[op.ch] ?? (use === 2 ? 'strong' : 'em');
		const children = items.slice(found + 1, c) as Inline[];
		const node: StyleNode = { type, from: op.from + op.count - use, to: closer.from + use, open: use, close: use, children };
		op.count -= use;
		closer.from += use;
		closer.count -= use;
		items.splice(found + 1, c - found - 1, node);
		let closerAt = found + 2;
		if (op.count === 0) {
			items.splice(found, 1);
			closerAt--;
		}
		if (closer.count === 0) items.splice(closerAt, 1);
		// Look at the same closer again (it can have characters left) or at the item after it.
		c = closerAt - 1;
	}
}

/** Turns the delimiters that did not match into text and joins neighbor text nodes. */
function finish(items: Item[], src: string): Inline[] {
	const out: Inline[] = [];
	for (const item of items) {
		let node: Inline;
		if (item.type === 'delim') {
			if (item.count === 0) continue;
			node = { type: 'text', from: item.from, to: item.from + item.count, text: src.slice(item.from, item.from + item.count) };
		} else if (item.type === 'strong' || item.type === 'em' || item.type === 'del' || item.type === 'mark') {
			node = { ...item, children: finish(item.children, src) };
		} else {
			node = item;
		}
		const last = out[out.length - 1];
		if (node.type === 'text' && last?.type === 'text' && last.to === node.from) {
			out[out.length - 1] = { type: 'text', from: last.from, to: node.to, text: src.slice(last.from, node.to) };
		} else {
			out.push(node);
		}
	}
	return out;
}

/** Parses the inline Markdown of one alias. Offsets are positions in the alias text. */
export function parseAlias(src: string, opts: ParseOptions = {}): Inline[] {
	if (src.length === 0) return [];
	if (src.length > MAX_ALIAS) return [{ type: 'text', from: 0, to: src.length, text: src }];
	const items = tokenize(src, opts);
	processEmphasis(items);
	return finish(items, src);
}

/** True when the parse has any node that is not plain text. */
export function hasMarkup(nodes: Inline[]): boolean {
	return nodes.some((n) => n.type !== 'text');
}

/** The text that a reader sees, with markup removed and math as its TeX source. */
export function plainText(nodes: Inline[]): string {
	return nodes.map((n) => ('children' in n ? plainText(n.children) : n.text)).join('');
}

export interface AliasLink {
	/** Start of `[[` in the line. */
	from: number;
	/** End of `]]` in the line. */
	to: number;
	/** The link target as written, without a table escape backslash. */
	target: string;
	aliasFrom: number;
	aliasTo: number;
	alias: string;
}

const LINK_RE = /(!?)\[\[([^[\]|\n]+?)(\\?\|)([^\n]*?)\]\]/g;

/** Each wikilink with an alias in one line of text. Embeds (`![[...]]`) and empty aliases are left out. */
export function findAliasLinks(line: string): AliasLink[] {
	const out: AliasLink[] = [];
	if (!line.includes('[[')) return out;
	LINK_RE.lastIndex = 0;
	for (let m = LINK_RE.exec(line); m; m = LINK_RE.exec(line)) {
		const alias = m[4] ?? '';
		if (m[1] === '!' || alias.trim() === '') continue;
		const from = m.index;
		const aliasFrom = from + 2 + (m[2] ?? '').length + (m[3] ?? '').length;
		out.push({ from, to: from + m[0].length, target: (m[2] ?? '').trim(), aliasFrom, aliasTo: aliasFrom + alias.length, alias });
	}
	return out;
}

export type DecoKind = 'hide' | 'mark' | 'math';

export interface Deco {
	kind: DecoKind;
	from: number;
	to: number;
	/** mark: the markup type (code, strong, em, del, mark). math: the TeX source. */
	value?: string;
}

export interface LinkPlan {
	from: number;
	to: number;
	target: string;
	decos: Deco[];
}

function planNodes(nodes: Inline[], base: number, out: Deco[]): void {
	for (const n of nodes) {
		if (n.type === 'text') continue;
		if (n.type === 'escape') {
			out.push({ kind: 'hide', from: base + n.from, to: base + n.from + 1 });
			continue;
		}
		if (n.type === 'math') {
			out.push({ kind: 'math', from: base + n.from, to: base + n.to, value: n.text });
			continue;
		}
		out.push({ kind: 'hide', from: base + n.from, to: base + n.from + n.open });
		out.push({ kind: 'mark', from: base + n.from + n.open, to: base + n.to - n.close, value: n.type });
		if (n.type !== 'code') planNodes(n.children, base, out);
		out.push({ kind: 'hide', from: base + n.to - n.close, to: base + n.to });
	}
}

/**
 * The Live Preview plan for one line: for each aliased link with markup, the ranges to hide (markup characters),
 * the ranges to style, and the math to draw. Offsets are positions in the line. Links without markup are left out.
 */
export function planLine(line: string, opts: ParseOptions = {}): LinkPlan[] {
	const out: LinkPlan[] = [];
	for (const link of findAliasLinks(line)) {
		const nodes = parseAlias(link.alias, opts);
		if (!hasMarkup(nodes)) continue;
		const decos: Deco[] = [];
		planNodes(nodes, link.aliasFrom, decos);
		decos.sort((a, b) => a.from - b.from || a.to - b.to);
		out.push({ from: link.from, to: link.to, target: link.target, decos });
	}
	return out;
}

/**
 * True when the text of a Reading view link is the text that core shows for a link without an alias. Used only when
 * the section source is not known. Then such a link is left as it is, so a note name is never read as markup.
 */
export function isDefaultText(text: string, href: string): boolean {
	if (text.trim() === '') return true;
	const hash = href.indexOf('#');
	const path = hash < 0 ? href : href.slice(0, hash);
	const sub = hash < 0 ? '' : href.slice(hash + 1);
	const base = path.split('/').pop() ?? path;
	const defaults = new Set([href, path, base, sub, sub.replace(/#/g, ' > '), href.replace(/#/g, ' > '), `${base} > ${sub.replace(/#/g, ' > ')}`]);
	if (path.endsWith('.md')) {
		defaults.add(path.slice(0, -3));
		defaults.add(base.slice(0, -3));
	}
	return defaults.has(text);
}
