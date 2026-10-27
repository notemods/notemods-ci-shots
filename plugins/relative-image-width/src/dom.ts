// DOM side: reads the size text that Obsidian keeps in the alt attribute of an image embed, and sizes the image.
// It reads attributes only. It never reads or changes core internals.
import { parsePandocAttrs, splitAlt, type CssSize } from './size';
import type { Options } from './settings';
import { addRule } from './rules';

/** Marks an image that this plugin sized. The value is the size text, so a second pass with no change is a no-op. */
export const MARK = 'data-riw';
/** The alt text before the plugin removed the size token from it. */
const ALT = 'data-riw-alt';
/** The alt text that the plugin wrote. When core writes a new alt in place, the two differ. */
const CAP = 'data-riw-cap';
/** Ids and classes that a Pandoc block added, so unload can remove them. */
const ADDED = 'data-riw-added';
/** The Pandoc text that Reading view hid. */
const HIDDEN = 'data-riw-hidden';
const PANDOC_HEAD = /^\{[^{}\n]*\}/;
/** Marks an embed wrapper that must span the line, so that a percent width of its image is a share of the column. */
const PCT = 'riw-pct';

/**
 * Every image that the plugin changed, as weak references. Live Preview keeps the DOM of an embed that scrolled out
 * of view and puts it back later, so unload must reach images that are not in the document now.
 */
const tracked = new Set<WeakRef<HTMLImageElement>>();
let sinceSweep = 0;

function track(img: HTMLImageElement): void {
	tracked.add(new WeakRef(img));
	if (++sinceSweep < 500) return;
	sinceSweep = 0;
	for (const ref of Array.from(tracked)) if (!ref.deref()) tracked.delete(ref);
}

/** Removes the changes from every image that the plugin changed (plugin unload). */
export function clearTracked(): void {
	for (const ref of Array.from(tracked)) {
		const img = ref.deref();
		if (img) clearImage(img);
	}
	tracked.clear();
	sinceSweep = 0;
}

/** The element that holds the image in the line: the embed wrapper, or the image itself. */
function holder(img: HTMLImageElement): HTMLElement {
	return img.closest<HTMLElement>('.internal-embed') ?? img;
}

/** True when the image is an image embed of the note, not an icon or a picture inside a note embed's own UI. */
export function isNoteImage(img: HTMLImageElement): boolean {
	const wrap = img.closest('.internal-embed');
	if (wrap && !wrap.classList.contains('image-embed')) return false;
	return !img.closest('.markdown-embed-link, .callout-icon, .hover-popover .popover-titlebar');
}

/**
 * The alt text to read the size from. For an image embed: the wrapper alt, which core keeps current when the link
 * changes in place (core keeps the same img element). For another image: the alt that the plugin saved, while the
 * image alt is still the caption that the plugin wrote; else the image alt (core wrote a new one).
 */
function altText(img: HTMLImageElement, wrap: Element | null): string {
	if (wrap) return wrap.getAttribute('alt') ?? '';
	const saved = img.getAttribute(ALT);
	if (saved !== null && img.getAttribute('alt') === img.getAttribute(CAP)) return saved;
	return img.getAttribute('alt') ?? '';
}

/** True when core sizes the image: a width or height attribute on the image or on its embed wrapper. */
function coreSized(img: HTMLImageElement, wrap: Element | null): boolean {
	return ['width', 'height'].some((a) => img.hasAttribute(a) || (wrap?.hasAttribute(a) ?? false));
}

function key(size: CssSize): string {
	return `${size.width ?? ''}x${size.height ?? ''}`;
}

/** Sets the size on the image. Writes only when the size differs, so it never starts a layout loop. */
export function setSize(img: HTMLImageElement, size: CssSize): boolean {
	const k = key(size);
	if (img.getAttribute(MARK) === k) return false;
	if (!img.hasAttribute(MARK)) track(img);
	img.setAttribute(MARK, k);
	// A percent width is a share of the text column. Live Preview puts the image in a shrink-to-fit
	// div.image-wrapper inside the embed: the embed then spans the line, the wrapper takes the percent and the image
	// fills the wrapper. Without that, the percent is a share of the image itself (CI run 40151444818).
	const embed = img.closest<HTMLElement>('.internal-embed');
	const pct = size.width?.endsWith('%') ?? false;
	const parent = img.parentElement;
	const inner = pct && embed && parent && parent !== embed && parent.classList.contains('image-wrapper');
	embed?.classList.toggle(PCT, pct);
	if (embed && inner) embed.style.setProperty('--riw-width', size.width);
	else embed?.style.removeProperty('--riw-width');
	img.style.setProperty('width', inner ? '100%' : (size.width ?? ''));
	img.style.setProperty('height', size.height ?? '');
	img.style.setProperty('object-fit', size.width && size.height ? 'contain' : '');
	return true;
}

/** Removes every change that the plugin made to the image. */
export function clearImage(img: HTMLImageElement): void {
	if (img.hasAttribute(MARK)) {
		img.style.removeProperty('width');
		img.style.removeProperty('height');
		img.style.removeProperty('object-fit');
		img.removeAttribute(MARK);
		const embed = img.closest<HTMLElement>('.internal-embed');
		embed?.classList.remove(PCT);
		embed?.style.removeProperty('--riw-width');
	}
	const alt = img.getAttribute(ALT);
	if (alt !== null) {
		// Put the alt back only when it is still the caption that the plugin wrote. Else core wrote a newer one.
		if (img.getAttribute('alt') === img.getAttribute(CAP)) img.setAttribute('alt', alt);
		img.removeAttribute(ALT);
		img.removeAttribute(CAP);
	}
	const added = img.getAttribute(ADDED);
	if (added !== null) {
		for (const item of added.split(' ')) {
			if (item.startsWith('#') && img.id === item.slice(1)) img.removeAttribute('id');
			else if (item.startsWith('.')) img.classList.remove(item.slice(1));
		}
		img.removeAttribute(ADDED);
	}
}

/** Puts back the Pandoc text that Reading view hid. */
export function restoreHidden(root: ParentNode): void {
	for (const el of Array.from(root.querySelectorAll<HTMLElement>(`[${HIDDEN}]`))) {
		el.replaceWith(document.createTextNode(el.getAttribute(HIDDEN) ?? ''));
	}
}

/** The text node directly after the image holder, if any. */
function nextText(el: HTMLElement): Text | null {
	const n = el.nextSibling;
	return n && n.nodeType === Node.TEXT_NODE ? (n as Text) : null;
}

/** Applies the id and classes of a Pandoc block and remembers them for unload. */
function applyIdClasses(img: HTMLImageElement, id: string | null, classes: string[]): void {
	const added: string[] = [];
	if (id && !img.id) {
		img.id = id;
		added.push(`#${id}`);
	}
	for (const c of classes) {
		if (img.classList.contains(c)) continue;
		img.classList.add(c);
		added.push(`.${c}`);
	}
	if (added.length > 0 && !img.hasAttribute(ADDED)) {
		track(img);
		img.setAttribute(ADDED, added.join(' '));
	}
}

/**
 * Reading view and PDF export: a Pandoc block in the text node after the image. It sizes the image and hides the text.
 * Returns the size, or null.
 */
function readingPandoc(img: HTMLImageElement): CssSize | null {
	const el = holder(img);
	// A second pass: the block is already hidden. Read it from the hidden span.
	const after = el.nextSibling;
	if (after instanceof HTMLElement && after.hasAttribute(HIDDEN)) {
		const again = parsePandocAttrs(after.getAttribute(HIDDEN) ?? '');
		return again && (again.width || again.height) ? { width: again.width, height: again.height } : null;
	}
	const text = nextText(el);
	if (!text) return null;
	const head = PANDOC_HEAD.exec(text.data);
	if (!head) return null;
	const attrs = parsePandocAttrs(head[0]);
	if (!attrs) return null;
	applyIdClasses(img, attrs.id, attrs.classes);
	const hidden = createSpan({ cls: 'riw-hidden', attr: { [HIDDEN]: head[0], 'aria-hidden': 'true' } });
	text.data = text.data.slice(head[0].length);
	text.before(hidden);
	return attrs.width || attrs.height ? { width: attrs.width, height: attrs.height } : null;
}

/** True for an image that the Pro default size may size: an image embed, or a Markdown image in a paragraph. */
function defaultTarget(img: HTMLImageElement): boolean {
	return !!img.closest('.image-embed') || img.parentElement?.tagName === 'P';
}

/** The context of one pass: the options, and the note property value for the Pro default size. */
export interface PassContext {
	opts: Options;
	property: unknown;
	/** Live Preview: the Pandoc size of an image, read from the editor text. Reading view reads the DOM. */
	pandocAt?: (img: HTMLImageElement) => CssSize | null;
}

/**
 * Sizes one image. The order: a relative size token in the alt text, then a Pandoc block, then the Pro default size
 * for an image with no size at all. A pixel size stays with core: the plugin sets nothing on it.
 * Returns true when it changed the DOM.
 */
export function sizeImage(img: HTMLImageElement, ctx: PassContext): boolean {
	if (!isNoteImage(img)) return false;
	const wrap = img.closest('.internal-embed');
	// A pixel size (also ![[a.png|50%|200]], where core puts "50%" in alt and sets width="200"): core sizes it.
	if (coreSized(img, wrap)) return release(img);
	const alt = altText(img, wrap);
	// A bare size ("50%") is read only from an image embed. Another image needs "caption|size", so a raw HTML
	// <img alt="50%"> or a badge with the alt "100%" keeps its size.
	const token = wrap || alt.includes('|') ? splitAlt(alt) : null;
	if (token) {
		// A CSS rule for this size text sizes the next embeds with it as soon as they are drawn (rules.ts).
		if (wrap) addRule(wrap, alt.slice(alt.lastIndexOf('|') + 1));
		let changed = setSize(img, token.size);
		// As core does for a pixel size: the caption, or the file name when there is no caption.
		const caption = token.caption || (wrap?.getAttribute('src') ?? '');
		if (img.getAttribute('alt') !== caption) {
			img.setAttribute(ALT, alt);
			img.setAttribute(CAP, caption);
			img.setAttribute('alt', caption);
			changed = true;
		}
		return changed;
	}
	if (ctx.opts.pandoc) {
		const p = ctx.pandocAt ? ctx.pandocAt(img) : readingPandoc(img);
		if (p) return setSize(img, p);
	}
	// A width or height attribute (core pixel size) or an inline size from another source is not a missing size.
	if (ctx.opts.fallback && defaultTarget(img) && !img.hasAttribute('width') && !img.hasAttribute('height') && !hasPixelToken(alt)) {
		const d = ctx.opts.fallback(ctx.property);
		if (d) return setSize(img, d);
	}
	return release(img);
}

/** Removes the changes of the plugin from one image. Returns true when there were any. */
function release(img: HTMLImageElement): boolean {
	if (!img.hasAttribute(MARK) && !img.hasAttribute(ALT)) return false;
	clearImage(img);
	return true;
}

/** True when the alt text ends in a pixel size, which core applies. */
function hasPixelToken(alt: string): boolean {
	return /(^|\|)\s*\d+(\s*[xX]\s*\d+)?\s*$/.test(alt);
}

/** Sizes every image under root. Returns the number of images that changed. */
export function sizeAll(root: ParentNode, ctx: PassContext, keep: (img: HTMLImageElement) => boolean = () => true, limit = 2000): number {
	let n = 0;
	const imgs = root.querySelectorAll('img');
	for (let i = 0; i < imgs.length && i < limit; i++) {
		const img = imgs[i] as HTMLImageElement;
		if (keep(img) && sizeImage(img, ctx)) n++;
	}
	return n;
}

/** Removes every change under root (unload, or a setting turned off). */
export function clearAll(root: ParentNode): void {
	for (const img of Array.from(root.querySelectorAll<HTMLImageElement>(`img[${MARK}], img[${ALT}], img[${ADDED}]`))) clearImage(img);
	restoreHidden(root);
}
