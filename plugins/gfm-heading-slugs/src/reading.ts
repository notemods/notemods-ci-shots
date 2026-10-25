// Reading view and PDF export: heading ids and slug link targets (post processor).
import type { MarkdownPostProcessorContext } from 'obsidian';
import type { SlugIndex } from './resolve';

/** Attribute that keeps the link target as written, before the plugin changed data-href. */
export const ORIGINAL_HREF = 'data-gfm-href';
/** Attribute with the slug on each heading (the id holds it too). */
export const SLUG_ATTR = 'data-gfm-slug';

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6';

export class ReadingView {
	/** The slug list (joined) that each note path had at its last render. A different list after a cache change renders again. */
	readonly rendered = new Map<string, string>();

	constructor(
		private index: SlugIndex,
		private enabled: () => boolean,
	) {}

	process(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
		if (!this.enabled()) return;
		const file = this.index.fileOf('', ctx.sourcePath);
		if (!file) return;
		const note = this.index.slugsOf(file);
		this.rendered.set(file.path, note.slugs.join('\n'));
		const headings = el.matches(HEADING_SELECTOR) ? [el] : Array.from(el.querySelectorAll<HTMLElement>(HEADING_SELECTOR));
		if (headings.length > 0 && note.headings.length > 0) {
			const info = ctx.getSectionInfo(el);
			for (const h of headings) {
				const i = this.headingIndex(h, info?.lineStart ?? null, headings.length, note.headings);
				const slug = i >= 0 ? note.slugs[i] : undefined;
				if (slug === undefined) continue;
				h.id = slug;
				h.setAttribute(SLUG_ATTR, slug);
			}
		}
		for (const a of Array.from(el.querySelectorAll<HTMLAnchorElement>('a.internal-link'))) this.fixLink(a, ctx.sourcePath);
	}

	/** Index of a rendered heading in the cache: by its line when the section is known, else by its text. */
	private headingIndex(h: HTMLElement, lineStart: number | null, count: number, headings: { heading: string; position: { start: { line: number } } }[]): number {
		if (lineStart !== null && count === 1) {
			const byLine = headings.findIndex((c) => c.position.start.line === lineStart);
			if (byLine >= 0) return byLine;
		}
		const text = h.getAttribute('data-heading') ?? h.textContent ?? '';
		return headings.findIndex((c) => c.heading === text);
	}

	/** A link with a slug target gets the Obsidian target, so that hover preview and core click work. */
	private fixLink(a: HTMLAnchorElement, sourcePath: string): void {
		const href = a.getAttribute(ORIGINAL_HREF) ?? a.getAttribute('data-href');
		if (!href || !href.includes('#')) return;
		const target = this.index.resolve(href, sourcePath);
		if (!target) return;
		const linktext = this.index.obsidianLinktext(target, sourcePath);
		a.setAttribute(ORIGINAL_HREF, href);
		a.setAttribute('data-href', linktext);
		a.setAttribute('href', linktext);
	}
}
