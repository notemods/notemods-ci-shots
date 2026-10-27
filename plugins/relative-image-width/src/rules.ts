// CSS rules for each size token that the plugin saw, in one constructable style sheet for each window.
// Live Preview draws new lines and measures them in the same frame, before any script of the plugin can run. A rule
// that matches the alt attribute of the embed sizes the image at once, when CodeMirror inserts it, so the measured
// height is right and the note does not jump while you scroll. The inline sizes of dom.ts stay as the fallback.
import { parseSize } from './size';

/** The most rules: one for each different size text. More sizes still work through the inline sizes. */
export const MAX_RULES = 300;
/** Characters that a size text can have and that are safe inside a CSS string. */
const SAFE = /^[0-9A-Za-z.% ]{1,40}$/;

const sheets = new Map<Document, { sheet: CSSStyleSheet; seen: Set<string> }>();

function sheetFor(doc: Document): { sheet: CSSStyleSheet; seen: Set<string> } | null {
	const old = sheets.get(doc);
	if (old) return old;
	const win = doc.defaultView as (Window & { CSSStyleSheet?: typeof CSSStyleSheet }) | null;
	if (!win?.CSSStyleSheet) return null;
	const sheet = new win.CSSStyleSheet();
	doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
	const entry = { sheet, seen: new Set<string>() };
	sheets.set(doc, entry);
	return entry;
}

/** The CSS text of the rules for one size text, or null when it is not a relative size. */
export function rulesFor(raw: string): string[] | null {
	if (!SAFE.test(raw)) return null;
	const size = parseSize(raw);
	if (!size) return null;
	const sel = `.internal-embed.image-embed:not([width]):not([height]):is([alt="${raw}"], [alt$="|${raw}"])`;
	const h = size.height ? ` height: ${size.height}; object-fit: contain;` : '';
	const w = size.width ?? 'auto';
	if (w.endsWith('%')) {
		return [`${sel} { width: 100%; }`, `${sel} > .image-wrapper { width: ${w}; }`, `${sel} > .image-wrapper > img { width: 100%;${h} }`, `${sel} > img { width: ${w};${h} }`];
	}
	return [`${sel} > img, ${sel} > .image-wrapper > img { width: ${w};${h} }`];
}

/** Adds the rules for the size text of an embed alt (the part after the last "|") in the window of el. */
export function addRule(el: Element, raw: string): void {
	const entry = sheetFor(el.ownerDocument);
	if (!entry || entry.seen.has(raw) || entry.seen.size >= MAX_RULES) return;
	entry.seen.add(raw);
	for (const rule of rulesFor(raw) ?? []) entry.sheet.insertRule(rule, entry.sheet.cssRules.length);
}

/** Removes every rule sheet (plugin unload). */
export function clearRules(): void {
	for (const [doc, { sheet }] of sheets) doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((s) => s !== sheet);
	sheets.clear();
}
