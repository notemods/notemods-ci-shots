// Runtime part shared by Live Preview and Reading view: resolve a block with the metadata cache, read its text,
// render it into a span, and keep the span up to date when the source note changes. Public API only.
import { Component, Keymap, MarkdownRenderer, TFile, resolveSubpath, type App, type BlockSubpathResult, type CachedMetadata, type HoverParent, type HoverPopover } from 'obsidian';
import { blockKey, cleanBlock, inlineFromBlock, isInlineKind, locateBlock, nestState, selectEmbeds, type BlockKind } from './embeds';

export type EmbedStyle = 'underline' | 'background' | 'none';

/** The settings in effect, after the Pro check. */
export interface Options {
	drawAll: boolean;
	listItems: boolean;
	style: EmbedStyle;
}

/** One embed, as written: `![[path#^blockId|display]]`. */
export interface EmbedRef {
	path: string;
	blockId: string;
	linktext: string;
	display: string;
}

export type Plan =
	| { state: 'missing'; ref: EmbedRef }
	| { state: 'native'; ref: EmbedRef; kind: BlockKind }
	| { state: 'inline'; ref: EmbedRef; kind: BlockKind; file: TFile; key: string };

export const INLINE_CLASS = 'ibe-inline';
const TOKEN_RE = /(\d+)/g;

interface Live {
	el: HTMLElement;
	ref: EmbedRef;
	sourcePath: string;
	chain: string[];
	owner: Component;
	inner: Component | null;
	plan: Plan;
	gen: number;
	hover: HoverParent;
}

/** The kind of a block from the cache, and its raw lines from the note text (rules 4, 5 and 9). */
export function blockFromCache(cache: CachedMetadata, sub: BlockSubpathResult, source: string, blockId: string): { kind: BlockKind; raw: string } {
	const lines = source.replace(/\r/g, '').split('\n');
	if (sub.list) {
		// The list item, from its marker line to the line that holds the id. Child items are left out.
		const start = sub.list.position.start.line;
		const end = Math.max(start, sub.list.position.end.line, sub.block.position.end.line);
		const idRe = new RegExp(`\\^${blockId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
		let last = start;
		for (let i = start; i <= end && i < lines.length; i++) {
			if (idRe.test(lines[i] ?? '')) {
				last = i;
				break;
			}
		}
		return { kind: 'listItem', raw: lines.slice(start, last + 1).join('\n') };
	}
	const pos = sub.block.position;
	return { kind: kindOf(cache, sub), raw: source.slice(pos.start.offset, pos.end.offset) };
}

const SECTION_KINDS: Record<string, BlockKind> = { paragraph: 'paragraph', heading: 'heading', table: 'table', code: 'code', math: 'math', callout: 'callout', blockquote: 'blockquote', list: 'list' };

/** Rule 9: the kind of a block from the section that holds it. A list item block has `list` set. */
export function kindOf(cache: CachedMetadata, sub: BlockSubpathResult): BlockKind {
	if (sub.list) return 'listItem';
	const line = sub.block.position.start.line;
	const section = cache.sections?.find((s) => s.position.start.line <= line && s.position.end.line >= line);
	return SECTION_KINDS[section?.type ?? 'paragraph'] ?? 'other';
}

export class InlineEmbeds {
	private live = new Set<Live>();
	/** Unsaved text of a source note that is open in an editor, by path. The saved cache replaces it on "changed". */
	private unsaved = new Map<string, string>();

	constructor(
		readonly app: App,
		readonly pluginId: string,
		readonly options: () => Options,
	) {}

	/** The file of a link, or the note itself for `![[#^id]]`. */
	fileOf(path: string, sourcePath: string): TFile | null {
		if (path === '') return this.app.vault.getFileByPath(sourcePath);
		return this.app.metadataCache.getFirstLinkpathDest(path, sourcePath);
	}

	/** Decides, without a file read, how an embed is drawn (rules 4, 9 and 17). */
	plan(ref: EmbedRef, sourcePath: string): Plan {
		const file = this.fileOf(ref.path, sourcePath);
		const cache = file ? this.app.metadataCache.getFileCache(file) : null;
		const sub = cache ? resolveSubpath(cache, `#^${ref.blockId}`) : null;
		if (!file || !cache || !sub || sub.type !== 'block') return { state: 'missing', ref };
		const kind = kindOf(cache, sub);
		if (!isInlineKind(kind, this.options().listItems)) return { state: 'native', ref, kind };
		return { state: 'inline', ref, kind, file, key: blockKey(file.path, ref.blockId) };
	}

	/** The cleaned inline text of a planned block (rules 5, 6 and 7). */
	async textOf(plan: Extract<Plan, { state: 'inline' }>): Promise<string | null> {
		const draft = this.unsaved.get(plan.file.path);
		if (draft !== undefined) {
			// The cache positions are for the saved file, so the pure locator reads the editor text.
			const res = inlineFromBlock(locateBlock(draft, plan.ref.blockId), plan.ref.blockId, this.options().listItems);
			return res.state === 'inline' ? res.text : null;
		}
		const cache = this.app.metadataCache.getFileCache(plan.file);
		const sub = cache ? resolveSubpath(cache, `#^${plan.ref.blockId}`) : null;
		if (!cache || !sub || sub.type !== 'block') return null;
		const source = await this.app.vault.cachedRead(plan.file);
		const block = blockFromCache(cache, sub, source, plan.ref.blockId);
		if (!isInlineKind(block.kind, this.options().listItems)) return null;
		return cleanBlock(block.raw, plan.ref.blockId, block.kind);
	}

	/**
	 * Makes the span for one embed and starts to fill it. `owner` owns the render children and the update listener:
	 * the span stops updating when the owner unloads. `chain` holds the keys of the inline embeds around this one.
	 */
	createSpan(plan: Plan, sourcePath: string, chain: string[], owner: Component, el: HTMLElement = createSpan()): { el: HTMLElement; done: Promise<void> } {
		el.addClass(INLINE_CLASS);
		el.setText(plan.ref.display);
		const live: Live = { el, ref: plan.ref, sourcePath, chain, owner, inner: null, plan, gen: 0, hover: { hoverPopover: null as HoverPopover | null } };
		this.live.add(live);
		owner.register(() => {
			this.live.delete(live);
			live.gen++;
		});
		el.setAttr('data-ibe-link', plan.ref.linktext);
		el.addEventListener('mouseover', (event) => {
			if (live.plan.state !== 'inline') return;
			this.app.workspace.trigger('hover-link', { event, source: this.pluginId, hoverParent: live.hover, targetEl: el, linktext: live.plan.ref.linktext, sourcePath });
		});
		el.addEventListener('click', (event) => {
			if (!Keymap.isModEvent(event)) return;
			event.preventDefault();
			event.stopPropagation();
			this.open(live.ref, sourcePath, event);
		});
		const done = this.fill(live);
		return { el, done };
	}

	/** Opens the source block (rule 12). */
	open(ref: EmbedRef, sourcePath: string, event: MouseEvent): void {
		void this.app.workspace.openLinkText(ref.linktext, sourcePath, Keymap.isModEvent(event));
	}

	private setLook(live: Live, state: Plan['state']): void {
		const { el } = live;
		el.removeClass('ibe-style-underline', 'ibe-style-background', 'ibe-style-none', 'is-unresolved');
		el.addClass(INLINE_CLASS, `ibe-style-${this.options().style}`);
		if (state === 'missing') {
			el.addClass('is-unresolved');
			el.setAttr('aria-label', `No block ${live.ref.linktext}`);
		} else {
			el.removeAttribute('aria-label');
		}
	}

	/** Draws the span for its current plan. A newer call wins over an older one that still waits for a read. */
	private async fill(live: Live): Promise<void> {
		const gen = ++live.gen;
		if (live.inner) {
			live.owner.removeChild(live.inner);
			live.inner = null;
		}
		const plan = live.plan;
		this.setLook(live, plan.state);
		if (plan.state !== 'inline') {
			live.el.setText(live.ref.display);
			return;
		}
		live.el.setAttr('data-ibe-key', plan.key);
		const text = await this.textOf(plan);
		if (gen !== live.gen) return;
		if (text === null) {
			this.setLook(live, 'missing');
			live.el.setText(live.ref.display);
			return;
		}
		const inner = new Component();
		live.inner = live.owner.addChild(inner);
		const next = [...live.chain, plan.key];
		// Nested inline embeds become tokens before the render, so the depth and loop checks see the whole chain.
		const nested: Array<{ plan: Plan; state: 'inline' | 'loop' | 'depth' }> = [];
		let markdown = '';
		let last = 0;
		const opts = this.options();
		for (const m of selectEmbeds(text, opts.drawAll)) {
			if (!m.selected) continue;
			const ref: EmbedRef = { path: m.path, blockId: m.blockId, linktext: m.linktext, display: m.display };
			const p = this.plan(ref, plan.file.path);
			if (p.state === 'native') continue;
			const state = p.state === 'inline' ? nestState(next, p.key) : 'inline';
			markdown += `${text.slice(last, m.from)}${nested.length}`;
			nested.push({ plan: p, state });
			last = m.to;
		}
		markdown += text.slice(last);
		const box = createDiv();
		await MarkdownRenderer.render(this.app, markdown, box, plan.file.path, inner);
		if (gen !== live.gen) return;
		live.el.empty();
		unwrapInto(box, live.el);
		const waits: Promise<void>[] = [];
		replaceTokens(live.el, (n) => {
			const item = nested[n];
			if (!item) return null;
			if (item.state !== 'inline') {
				// Rule 18: a loop or a level past the limit shows the link text.
				return createSpan({ cls: 'ibe-link-text', text: item.plan.ref.display, attr: { 'data-ibe-link': item.plan.ref.linktext } });
			}
			const child = this.createSpan(item.plan, plan.file.path, next, inner);
			waits.push(child.done);
			return child.el;
		});
		await Promise.all(waits);
	}

	/** True when a span shows a block of this file. */
	watches(path: string): boolean {
		for (const live of this.live) if (live.plan.state === 'inline' && live.plan.file.path === path) return true;
		return false;
	}

	/** Rule 16 before the save: an editor changed the text of a source note. */
	editorChanged(path: string, text: string): void {
		this.unsaved.set(path, text);
		this.refreshFile(path);
	}

	/** The note is saved and indexed again: the cache is current. */
	fileChanged(path: string): void {
		this.unsaved.delete(path);
		this.refreshFile(path);
	}

	/** Rule 16: redraws each span that shows a block of this file, and each span that shows a missing block. */
	refreshFile(path: string | null): void {
		for (const live of Array.from(this.live)) {
			const target = live.plan.state === 'inline' ? live.plan.file.path : null;
			if (path !== null && target !== path && live.plan.state !== 'missing' && live.plan.state !== 'native') continue;
			live.plan = this.plan(live.ref, live.sourcePath);
			void this.fill(live);
		}
	}

	/** Number of spans that are in use (tests). */
	get size(): number {
		return this.live.size;
	}

	clear(): void {
		this.live.clear();
		this.unsaved.clear();
	}
}

/** Rule 8: moves the rendered nodes into the span and unwraps a single paragraph. */
export function unwrapInto(box: HTMLElement, el: HTMLElement): void {
	const elements = Array.from(box.children);
	const onlyText = Array.from(box.childNodes).every((n) => n.nodeType !== Node.TEXT_NODE || (n.nodeValue ?? '').trim() === '');
	const source = elements.length === 1 && elements[0]?.tagName === 'P' && onlyText ? (elements[0] as HTMLElement) : box;
	while (source.firstChild) el.appendChild(source.firstChild);
}

/** Replaces each `n` token in the text nodes of el with the node that make() returns. */
export function replaceTokens(el: HTMLElement, make: (n: number) => Node | null): number {
	const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
	const nodes: Text[] = [];
	for (let n = walker.nextNode(); n; n = walker.nextNode()) if ((n.nodeValue ?? '').includes('')) nodes.push(n as Text);
	let done = 0;
	for (const node of nodes) {
		const value = node.nodeValue ?? '';
		const frag = createFragment();
		let last = 0;
		for (const m of value.matchAll(TOKEN_RE)) {
			frag.appendChild(el.ownerDocument.createTextNode(value.slice(last, m.index)));
			const made = make(Number(m[1]));
			if (made) {
				frag.appendChild(made);
				done++;
			}
			last = m.index + m[0].length;
		}
		frag.appendChild(el.ownerDocument.createTextNode(value.slice(last)));
		node.replaceWith(frag);
	}
	return done;
}
