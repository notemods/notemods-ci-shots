// Obsidian glue: slugs of a note from the metadata cache, link resolution and the jump to a heading.
import { MarkdownView, TFile, type App, type CachedMetadata, type HeadingCache, type PaneType } from 'obsidian';
import { decodeFragment, decodePath, findObsidian, findSlug, slugAll, type HeadingLookup } from './slug';

export interface NoteSlugs {
	headings: HeadingCache[];
	slugs: string[];
}

export interface SlugTarget {
	file: TFile;
	/** Index in the headings of the note. */
	index: number;
	heading: HeadingCache;
	slug: string;
}

/** Wait after the core jump before the plugin moves to a later duplicate heading. */
const DUPLICATE_JUMP_DELAY_MS = 120;

const EMPTY: NoteSlugs = { headings: [], slugs: [] };

export class SlugIndex {
	/** One entry for each cache object. A new cache object (after an edit) gets new slugs. */
	private byCache = new WeakMap<CachedMetadata, NoteSlugs>();
	/** Count of slug computations. The e2e test reads it to prove that typing does no work. */
	computeCount = 0;

	constructor(private app: App) {}

	/** Headings and slugs of a note, from the metadata cache. */
	slugsOf(file: TFile | null): NoteSlugs {
		if (!file) return EMPTY;
		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache?.headings?.length) return EMPTY;
		let hit = this.byCache.get(cache);
		if (!hit || hit.headings !== cache.headings) {
			this.computeCount++;
			hit = { headings: cache.headings, slugs: slugAll(cache.headings.map((h) => h.heading)) };
			this.byCache.set(cache, hit);
		}
		return hit;
	}

	/** The note of a link path ('' = the source note). Tries the path as written, then without ".md". */
	fileOf(path: string, sourcePath: string): TFile | null {
		if (path === '') return this.app.vault.getFileByPath(sourcePath);
		const mc = this.app.metadataCache;
		return mc.getFirstLinkpathDest(path, sourcePath) ?? (path.endsWith('.md') ? mc.getFirstLinkpathDest(path.slice(0, -3), sourcePath) : null);
	}

	/** Heading texts for a link path, for planConvertWith. */
	lookup(sourcePath: string): HeadingLookup {
		return (path) => {
			const file = this.fileOf(path, sourcePath);
			if (!file) return null;
			return this.slugsOf(file).headings.map((h) => h.heading);
		};
	}

	/**
	 * The heading that a link destination with a GitHub slug points to, or null.
	 * `dest` is the destination as written or as Obsidian stores it in data-href: "#slug" or "note.md#slug".
	 */
	resolve(dest: string, sourcePath: string): SlugTarget | null {
		const hash = dest.indexOf('#');
		if (hash < 0) return null;
		const fragment = decodeFragment(dest.slice(hash + 1));
		if (fragment === '') return null;
		const file = this.fileOf(decodePath(dest.slice(0, hash)), sourcePath);
		if (!file) return null;
		const note = this.slugsOf(file);
		const index = findSlug(note.slugs, fragment);
		const heading = note.headings[index];
		if (index < 0 || !heading) return null;
		return { file, index, heading, slug: note.slugs[index] ?? '' };
	}

	/**
	 * Link text in the Obsidian form for a target: "note#Heading text".
	 * Characters that Obsidian drops from heading links become spaces.
	 */
	obsidianLinktext(target: SlugTarget, sourcePath: string): string {
		// The note name is always written: an embed or a hover preview resolves '' against another note.
		const path = this.app.metadataCache.fileToLinktext(target.file, sourcePath);
		return `${path}#${obsidianKeyCase(target.heading.heading)}`;
	}

	/** True when Obsidian's own heading match opens this heading (it opens the first match). */
	isFirstMatch(target: SlugTarget): boolean {
		const note = this.slugsOf(target.file);
		return findObsidian(note.headings.map((h) => h.heading), target.heading.heading) === target.index;
	}

	/** Opens the heading. Core does the jump; for a later duplicate heading the plugin moves to its line after. */
	async open(target: SlugTarget, sourcePath: string, newLeaf: PaneType | boolean): Promise<void> {
		await this.app.workspace.openLinkText(this.obsidianLinktext(target, sourcePath), sourcePath, newLeaf);
		if (this.isFirstMatch(target)) return;
		// Core moves to the first heading with this text. Wait for that jump, then move to the duplicate.
		await new Promise<void>((r) => window.setTimeout(r, DUPLICATE_JUMP_DELAY_MS));
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view || view.file?.path !== target.file.path) return;
		const line = target.heading.position.start.line;
		if (view.getMode() === 'preview') {
			view.previewMode.applyScroll(line);
		} else {
			const pos = { line, ch: 0 };
			view.editor.setCursor(pos);
			view.editor.scrollIntoView({ from: pos, to: pos }, true);
		}
	}
}

/** The heading text with the characters that Obsidian drops from heading links replaced, case kept. */
export function obsidianKeyCase(text: string): string {
	return text
		.replace(/[#|^:%[\]\\]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Narrowing helper for event targets. */
export function asElement(t: EventTarget | null): HTMLElement | null {
	return t instanceof HTMLElement ? t : null;
}
