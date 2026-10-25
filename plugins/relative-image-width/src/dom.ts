// DOM side: reads the size text that Obsidian keeps in the alt attribute of an image embed, and sizes the image.
// It reads attributes only. It never reads or changes core internals.
import { parsePandocAttrs, splitAlt, type CssSize } from './size';
import type { Options } from './settings';

/** Marks an image that this plugin sized. The value is the size text, so a second pass with no change is a no-op. */
export const MARK = 'data-riw';
/** The alt text before the plugin removed the size token from it. */
const ALT = 'data-riw-alt';
/** Ids and classes that a Pandoc block added, so unload can remove them. */
const ADDED = 'data-riw-added';
/** The Pandoc text that Reading view hid. */
const HIDDEN = 'data-riw-hidden';
const PANDOC_HEAD = /^\{[^{}\n]*\}/;

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

/** The alt text to read the size from: the original alt that the plugin saved, the wrapper alt, or the image alt. */
function altText(img: HTMLImageElement): string {
	const saved = img.getAttribute(ALT);
	if (saved !== null) return saved;
	const wrap = img.closest('.internal-embed');
	return wrap?.getAttribute('alt') ?? img.getAttribute('alt') ?? '';
}

function key(size: CssSize): string {
	return `${size.width ?? ''}x${size.height ?? ''}`;
}

/** Sets the size on the image. Writes only when the size differs, so it never starts a layout loop. */
export function setSize(img: HTMLImageElement, size: CssSize): boolean {
	const k = key(size);
	if (img.getAttribute(MARK) === k) return false;
	img.setAttribute(MARK, k);
	img.style.setProperty('width', size.width ?? '');
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
	}
	const alt = img.getAttribute(ALT);
	if (alt !== null) {
		img.setAttribute('alt', alt);
		img.removeAttribute(ALT);
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
	if (added.length > 0 && !img.hasAttribute(ADDED)) img.setAttribute(ADDED, added.join(' '));
}

/**
 * Reading view and PDF export: a Pandoc block in the text node after the image. It sizes the image and hides the text.
 * Returns the size, or null.
 */
function readingPandoc(img: HTMLImageElement): CssSize | null {
	const text = nextText(holder(img));
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
	const alt = altText(img);
	const token = splitAlt(alt);
	if (token) {
		let changed = setSize(img, token.size);
		if (img.getAttribute(ALT) === null && img.getAttribute('alt') === alt) {
			img.setAttribute(ALT, alt);
			// As core does for a pixel size: the caption, or the file name when there is no caption.
			img.setAttribute('alt', token.caption || (img.closest('.internal-embed')?.getAttribute('src') ?? ''));
			changed = true;
		}
		return changed;
	}
	if (ctx.opts.pandoc) {
		const p = ctx.pandocAt ? ctx.pandocAt(img) : readingPandoc(img);
		if (p) return setSize(img, p);
	}
	// A width or height attribute (core pixel size) or an inline size from another source is not a missing size.
	if (ctx.opts.fallback && !img.hasAttribute('width') && !img.hasAttribute('height') && !hasPixelToken(alt)) {
		const d = ctx.opts.fallback(ctx.property);
		if (d) return setSize(img, d);
	}
	if (img.hasAttribute(MARK)) {
		clearImage(img);
		return true;
	}
	return false;
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
