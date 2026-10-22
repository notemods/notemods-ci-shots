// The New button of a base embedded in a note (![[Tasks.base]] or ![[Tasks.base#View]]). No Obsidian imports.
// A click on that button records which base and view it belongs to. The empty note that the app makes right
// after the click then gets the setup of that base. A `base` code block has no base file, so it is left alone.

/** How long a recorded click stays valid. The app makes the note a few milliseconds after the click. */
export const EMBED_CLICK_MS = 2000;

export interface EmbedHit {
	/** The src attribute of the embed: the link text of the base, with an optional #view. */
	src: string;
	/** The view name in the toolbar of the embed, "" when it cannot be read. */
	shownView: string;
	/** The element of the embed (class bases-embed). */
	el: HTMLElement;
}

const isElement = (v: unknown): v is HTMLElement => !!v && typeof (v as HTMLElement).closest === 'function' && typeof (v as HTMLElement).getAttribute === 'function';

/**
 * The embedded base whose New button holds the event target, or null. null for a click elsewhere, for the New
 * button of a base tab and for a `base` code block (it has the class bases-embed too, but no base file).
 */
export function findEmbedNew(target: unknown): EmbedHit | null {
	if (!isElement(target)) return null;
	const button = target.closest('.bases-toolbar-new-item-menu');
	const embed = button?.closest('.bases-embed');
	if (!button || !isElement(embed) || embed.closest('.block-language-base')) return null;
	const src = embed.closest('[src]')?.getAttribute('src')?.trim() ?? '';
	if (!src) return null;
	const header = button.closest('.bases-header') ?? embed;
	const label = header.querySelector('.bases-toolbar-views-menu .text-button-label');
	return { src, shownView: label?.textContent?.trim() ?? '', el: embed };
}

/** The link path and the #view part of an embed src. "Books.base#Unread" gives Books.base and Unread. */
export function parseEmbedSrc(src: string): { path: string; view: string } {
	const text = src.split('|')[0] ?? '';
	const hash = text.indexOf('#');
	if (hash < 0) return { path: text.trim(), view: '' };
	return { path: text.slice(0, hash).trim(), view: text.slice(hash + 1).trim() };
}

/** The view that the New button of the embed uses: the view the embed shows, else the #view of the link. */
export function embedView(hit: Pick<EmbedHit, 'src' | 'shownView'>): string {
	return hit.shownView || parseEmbedSrc(hit.src).view;
}

/** One recorded value that is used once and only within ttl milliseconds of the record. */
export class OneShot<T> {
	private item: { value: T; time: number } | null = null;

	constructor(private readonly ttl: number = EMBED_CLICK_MS) {}

	record(value: T, now: number): void {
		this.item = { value, time: now };
	}

	/** The value if it is not older than ttl. The record is cleared in each case. */
	take(now: number): T | null {
		const item = this.item;
		this.item = null;
		if (!item || now < item.time || now - item.time > this.ttl) return null;
		return item.value;
	}

	clear(): void {
		this.item = null;
	}
}
