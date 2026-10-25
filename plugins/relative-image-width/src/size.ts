// Pure parsers for the size of an image. No DOM, no Obsidian API. The golden vectors in
// packages/spec/vectors/relative-image-width.json test every function here.

/** A CSS size for an image. A null side keeps its natural size (auto). */
export interface CssSize {
	width: string | null;
	height: string | null;
}

/** Pandoc link attributes that this plugin applies: id, classes, and the size. */
export interface PandocAttrs extends CssSize {
	id: string | null;
	classes: string[];
}

/** A Pandoc attribute block after an image link in a line of Markdown. from and to are offsets of the "{...}" text. */
export interface PandocMatch {
	from: number;
	to: number;
	attrs: PandocAttrs;
}

/** The largest number that a size can have. A larger number is a typing error, and it does not apply. */
export const MAX_NUMBER = 10000;

const RELATIVE = new Set(['%', 'em', 'rem', 'vw', 'vh']);
const PANDOC_UNITS = new Set(['%', 'em', 'rem', 'vw', 'vh', 'px', 'cm', 'mm', 'in']);
const PART = /^(\d+(?:\.\d+)?|\.\d+)(%|em|rem|vw|vh|px)?$/i;

interface Part {
	value: string;
	unit: string;
}

function readPart(text: string, units: Set<string>): Part | null {
	const m = PART.exec(text.trim()) ?? /^(\d+(?:\.\d+)?|\.\d+)(cm|mm|in)$/i.exec(text.trim());
	if (!m) return null;
	const n = Number(m[1]);
	if (!(n > 0) || n > MAX_NUMBER) return null;
	const unit = (m[2] ?? 'px').toLowerCase();
	if (!units.has(unit) && unit !== 'px') return null;
	return { value: String(n), unit };
}

/**
 * CSS for one side. A percent width is a percent of the text column. A percent height is a percent of the window
 * height (vh), because CSS ignores a percent height in a block of auto height.
 */
function css(part: Part, side: 'width' | 'height'): string {
	if (part.unit === '%' && side === 'height') return `${part.value}vh`;
	return `${part.value}${part.unit}`;
}

/**
 * Reads a size token: "W" or "WxH". W and H are a number and a unit (%, em, rem, vw, vh, px). A number with no unit
 * is pixels. Returns null when the token is not a size, or when it has no relative unit (Obsidian core sizes a pixel
 * size, and the plugin keeps that behavior).
 */
export function parseSize(token: string): CssSize | null {
	if (typeof token !== 'string') return null;
	const text = token.trim();
	if (text.length === 0 || text.length > 40) return null;
	const sides = text.split(/\s*[xX]\s*/);
	if (sides.length > 2) return null;
	const w = readPart(sides[0] ?? '', RELATIVE);
	if (!w) return null;
	const h = sides.length === 2 ? readPart(sides[1] ?? '', RELATIVE) : null;
	if (sides.length === 2 && !h) return null;
	if (w.unit === 'px' && (!h || h.unit === 'px')) return null;
	return { width: css(w, 'width'), height: h ? css(h, 'height') : null };
}

/**
 * Splits an alt text "caption|size" (Obsidian writes the text after the first "|" of a wikilink embed, or the alt of a
 * Markdown image, to the alt attribute). The size is the last "|" part. Returns null when that part is not a relative
 * size.
 */
export function splitAlt(alt: string): { caption: string; size: CssSize } | null {
	if (typeof alt !== 'string') return null;
	const cut = alt.lastIndexOf('|');
	const size = parseSize(cut < 0 ? alt : alt.slice(cut + 1));
	if (!size) return null;
	return { caption: cut < 0 ? '' : alt.slice(0, cut).trim(), size };
}

function pandocValue(raw: string, side: 'width' | 'height'): string | null {
	const v = raw.replace(/^(["'])(.*)\1$/, '$2').trim();
	const part = readPart(v, PANDOC_UNITS);
	return part ? css(part, side) : null;
}

/**
 * Reads a Pandoc attribute block "{#id .class width=50% height=30%}". Keys other than width and height are kept out.
 * Returns null when the text is not one attribute block, or when it has no id, class, width or height.
 */
export function parsePandocAttrs(text: string): PandocAttrs | null {
	if (typeof text !== 'string' || text.length > 300) return null;
	const m = /^\{([^{}\n]*)\}$/.exec(text.trim());
	if (!m) return null;
	const out: PandocAttrs = { id: null, classes: [], width: null, height: null };
	const items = (m[1] ?? '').match(/[^\s"'=]+=(?:"[^"]*"|'[^']*'|[^\s"']+)|[^\s]+/g) ?? [];
	let any = false;
	for (const item of items) {
		if (/^#[\w-]+$/.test(item)) {
			out.id = item.slice(1);
			any = true;
		} else if (/^\.[\w-]+$/.test(item)) {
			out.classes.push(item.slice(1));
			any = true;
		} else if (/^[\w-]+=/.test(item)) {
			const eq = item.indexOf('=');
			const key = item.slice(0, eq).toLowerCase();
			if (key === 'width' || key === 'height') {
				const v = pandocValue(item.slice(eq + 1), key);
				if (v) {
					out[key] = v;
					any = true;
				}
			}
		} else {
			return null;
		}
	}
	return any ? out : null;
}

/** Image links: a wikilink embed ![[...]] or a Markdown image ![alt](target), followed at once by "{". */
const LINK_THEN_ATTRS = /(!\[\[[^\]\n]+\]\]|!\[[^\]\n]*\]\([^)\n]*\))(\{[^{}\n]*\})/g;

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico|tiff?)$/i;

/** True when the link of ![[target|...]] or ![alt](target "title") names an image file. A note or a PDF is not. */
export function isImageLink(link: string): boolean {
	let target: string;
	if (link.startsWith('![[')) target = (link.slice(3, -2).split('|')[0] ?? '').split('#')[0] ?? '';
	else {
		const inner = link.slice(link.indexOf('](') + 2, -1).trim();
		const m = /^<([^>]*)>/.exec(inner);
		target = (m ? (m[1] ?? '') : (inner.split(/\s+/)[0] ?? '')).split(/[?#]/)[0] ?? '';
	}
	return IMAGE_EXT.test(target.trim());
}

/** Finds each Pandoc attribute block directly after an image link (an image file) in one line. */
export function findPandocAttrs(line: string): PandocMatch[] {
	if (typeof line !== 'string' || line.length > 20000) return [];
	const out: PandocMatch[] = [];
	for (const m of line.matchAll(LINK_THEN_ATTRS)) {
		if (!isImageLink(m[1] ?? '')) continue;
		const attrs = parsePandocAttrs(m[2] ?? '');
		if (!attrs) continue;
		const from = (m.index ?? 0) + (m[1] ?? '').length;
		out.push({ from, to: from + (m[2] ?? '').length, attrs });
	}
	return out;
}

/** Reads the Pro default size of a note: a valid note property wins over the setting. Pixel sizes are allowed here. */
export function defaultSize(setting: string, property: unknown): CssSize | null {
	for (const v of [property, setting]) {
		if (typeof v !== 'string' && typeof v !== 'number') continue;
		const text = String(v).trim();
		if (!text) continue;
		const rel = parseSize(text);
		if (rel) return rel;
		const px = /^(\d+)(px)?$/i.exec(text);
		if (px && Number(px[1]) > 0 && Number(px[1]) <= MAX_NUMBER) return { width: `${Number(px[1])}px`, height: null };
	}
	return null;
}
