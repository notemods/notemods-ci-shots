import { ItemView, Platform, setIcon, setTooltip, type WorkspaceLeaf } from 'obsidian';
import { filterOutline, visibleRow, type Outline, type OutlineItem } from './outline';
import { isPro } from './pro';
import type EmbedOutlinePlugin from './main';

export const VIEW_TYPE = 'embed-outline';

const ICONS: Partial<Record<OutlineItem['kind'], string>> = {
	embed: 'file-text',
	callout: 'quote',
	'list-heading': 'list',
	broken: 'alert-triangle',
	cycle: 'repeat',
};

const fmt = (n: number): string => n.toLocaleString();

/** Stable keys survive inserted rows. Repeated siblings keep separate occurrence numbers. */
function rowKeys(items: readonly OutlineItem[], prefix = ''): string[] {
	const seen = new Map<string, number>();
	return items.map(it => {
		const identity = JSON.stringify([it.kind, it.path, it.heading ?? it.text, it.link ?? '']);
		const occurrence = seen.get(identity) ?? 0;
		seen.set(identity, occurrence + 1);
		return `${prefix}${identity}:${occurrence}/`;
	});
}

/** Short display name of an embed row: the note name and the heading or block part. */
export function embedLabel(item: OutlineItem): string {
	const link = item.link ?? item.text;
	const i = link.indexOf('#');
	const note = (i < 0 ? link : link.slice(0, i)).split('/').pop() ?? link;
	const sub = i < 0 ? '' : link.slice(i + 1).replace(/#/g, ' > ');
	if (!note) return sub;
	return sub ? `${note} > ${sub}` : note;
}

/** Text of a broken or cycle row. */
export function brokenLabel(item: OutlineItem): string {
	if (item.kind === 'cycle') return `Embeds itself: ${embedLabel(item)}`;
	const what = item.missing === 'heading' ? 'No such heading' : item.missing === 'block' ? 'No such block' : 'No such note';
	return `${what}: ${embedLabel(item)}`;
}

/** Text that the panel shows for a row. */
export function rowLabel(item: OutlineItem): string {
	return item.kind === 'embed' ? embedLabel(item) : item.kind === 'broken' || item.kind === 'cycle' ? brokenLabel(item) : item.text;
}

export class EmbedOutlineView extends ItemView {
	private readonly plugin: EmbedOutlinePlugin;
	/** Keys of rows the user folded. */
	private readonly folded = new Set<string>();
	private readonly noteFolds = new Map<string, Set<string>>();
	private outline: Outline | null = null;
	private message = '';
	private query = '';
	/** Rows from the top level down to the current section, from the plugin's outline, or null. */
	private active: OutlineItem[] | null = null;
	/** The drawn row element and fold key of each source row, for the current section mark. */
	private readonly rowEls = new Map<OutlineItem, HTMLElement>();
	private readonly rowKeyOf = new Map<OutlineItem, string>();
	/** Search results are copies: the source row of each copy. */
	private readonly origins = new Map<OutlineItem, OutlineItem>();

	constructor(leaf: WorkspaceLeaf, plugin: EmbedOutlinePlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Embed outline';
	}

	getIcon(): string {
		return 'list-tree';
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass('embed-outline');
		this.draw();
		this.plugin.scheduleRefresh(0);
		await Promise.resolve();
	}

	async onClose(): Promise<void> {
		this.plugin.syncFollow(this);
		this.active = null;
		this.clearRows();
		this.contentEl.empty();
		this.folded.clear();
		this.noteFolds.clear();
		this.outline = null;
		this.query = '';
		await Promise.resolve();
	}

	/** Shows an outline, or a message when there is none. */
	show(outline: Outline | null, message = ''): void {
		if (outline?.path !== this.outline?.path) {
			const oldPath = this.outline?.path;
			if (oldPath) {
				this.noteFolds.delete(oldPath);
				this.noteFolds.set(oldPath, new Set(this.folded));
				while (this.noteFolds.size > 20) this.noteFolds.delete(this.noteFolds.keys().next().value!);
			}
			this.folded.clear();
			for (const key of this.noteFolds.get(outline?.path ?? '') ?? []) this.folded.add(key);
			this.query = '';
		}
		this.outline = outline;
		this.message = message;
		this.draw();
	}

	current(): Outline | null {
		return this.outline;
	}

	/** Marks the current section: the deepest row of the chain that the panel shows. Null removes the mark. */
	setActive(chain: OutlineItem[] | null): void {
		this.active = chain?.length ? chain : null;
		this.paintActive(true);
	}

	private clearRows(): void {
		this.rowEls.clear();
		this.rowKeyOf.clear();
		this.origins.clear();
	}

	private paintActive(reveal: boolean): void {
		for (const el of Array.from(this.contentEl.querySelectorAll<HTMLElement>('.embed-outline-row.is-active'))) {
			el.removeClass('is-active');
			el.removeAttribute('aria-current');
		}
		const chain = this.active;
		if (!chain) return;
		// During a search every path is open, and only the rows that the search shows can have the mark.
		const searching = this.query.trim().length > 0;
		const row = visibleRow(chain, (r) => {
			const key = this.rowKeyOf.get(r);
			return !searching && key !== undefined && this.folded.has(key);
		});
		const el = row ? this.rowEls.get(row) : undefined;
		if (!el) return;
		el.addClass('is-active');
		el.setAttr('aria-current', 'location');
		if (reveal) this.reveal(el);
	}

	/** Scrolls the panel so a row shows, only when the row is outside it. It does not move the focus. */
	private reveal(el: HTMLElement): void {
		const box = this.contentEl.getBoundingClientRect();
		const head = this.contentEl.querySelector('.embed-outline-header')?.getBoundingClientRect().height ?? 0;
		const r = el.getBoundingClientRect();
		if (r.top < box.top + head) this.contentEl.scrollTop -= box.top + head - r.top;
		else if (r.bottom > box.bottom) this.contentEl.scrollTop += r.bottom - box.bottom;
	}

	private draw(): void {
		const el = this.contentEl;
		const oldInput = el.querySelector<HTMLInputElement>('.embed-outline-search input');
		const focused = oldInput === el.ownerDocument.activeElement;
		const selection = oldInput?.selectionStart ?? null;
		el.empty();
		this.clearRows();
		const o = this.outline;
		if (!o) {
			el.createDiv({ cls: 'embed-outline-empty', text: this.message || 'Open a note to see its outline.' });
			return;
		}
		this.drawHeader(el, o);
		const search = el.createDiv({ cls: 'embed-outline-search', attr: { role: 'search' } });
		const input = search.createEl('input', { attr: { type: 'search', placeholder: 'Search outline', 'aria-label': 'Search outline' } });
		input.value = this.query;
		const clear = search.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': 'Clear outline search' } });
		setIcon(clear, 'x');
		const body = el.createDiv({ cls: 'embed-outline-body' });
		const update = (): void => {
			this.query = input.value;
			const fold = el.querySelector<HTMLButtonElement>('.embed-outline-buttons button');
			if (fold) fold.disabled = this.query.trim().length > 0;
			body.empty();
			this.clearRows();
			this.drawOutline(body, o);
			this.paintActive(false);
		};
		input.addEventListener('input', update);
		const reset = (): void => {
			input.value = '';
			update();
			input.focus();
		};
		clear.addEventListener('click', reset);
		input.addEventListener('keydown', (evt) => {
			if (evt.key === 'Escape') {
				evt.preventDefault();
				reset();
			}
		});
		update();
		if (focused) {
			input.focus();
			if (selection !== null) input.setSelectionRange(selection, selection);
		}
	}

	private drawOutline(el: HTMLElement, o: Outline): void {
		if (o.items.length === 0 && !this.query.trim()) {
			el.createDiv({ cls: 'embed-outline-empty', text: 'This note has no headings, callouts or embedded notes.' });
			return;
		}
		const searching = this.query.trim().length > 0;
		const filtered = filterOutline(o.items, this.query, rowLabel, this.origins);
		if (searching) {
			el.createDiv({ cls: 'embed-outline-search-status', text: `${filtered.matches} ${filtered.matches === 1 ? 'match' : 'matches'}`, attr: { role: 'status', 'aria-live': 'polite' } });
			if (!filtered.items.length) {
				el.createDiv({ cls: 'embed-outline-empty', text: 'No matching rows. Clear the search to see the full outline.' });
				return;
			}
		}
		if (!isPro() && o.locked > 0) {
			const n = o.locked;
			el.createDiv({ cls: 'embed-outline-hint', text: `${n} ${n === 1 ? 'embed sits' : 'embeds sit'} inside embedded notes. Pro opens them.` });
		}
		if (o.truncated) el.createDiv({ cls: 'embed-outline-hint', text: 'This outline is very long, so some notes, rows or embedded word counts are left out.' });
		const tree = el.createDiv({ cls: 'embed-outline-tree', attr: { role: 'tree' } });
		this.drawItems(tree, filtered.items, '');
	}

	private drawHeader(el: HTMLElement, o: Outline): void {
		const head = el.createDiv({ cls: 'embed-outline-header' });
		const name = o.path.split('/').pop()?.replace(/\.md$/, '') ?? o.path;
		head.createDiv({ cls: 'embed-outline-title', text: name });
		const stats: string[] = [`${o.embeds} ${o.embeds === 1 ? 'embed' : 'embeds'}`];
		if (o.words !== undefined) stats.push(`${fmt(o.words)} words`);
		if (o.broken > 0) stats.push(`${o.broken} broken`);
		head.createDiv({ cls: 'embed-outline-stats', text: stats.join(', ') });
		const buttons = head.createDiv({ cls: 'embed-outline-buttons' });
		const fold = buttons.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': 'Fold all' } });
		setIcon(fold, 'chevrons-down-up');
		fold.addEventListener('click', () => this.foldAll());
		const copy = buttons.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': 'Copy as a Markdown list (pro feature)' } });
		setIcon(copy, 'copy');
		copy.addEventListener('click', () => void this.plugin.copyOutline());
	}

	private foldAll(): void {
		const o = this.outline;
		if (!o) return;
		const rowIds = rowKeys(o.items);
		const keys = o.items.flatMap((it, i) => (it.children.length ? [rowIds[i]!] : []));
		const allFolded = keys.every((k) => this.folded.has(k));
		this.folded.clear();
		if (!allFolded) for (const k of keys) this.folded.add(k);
		this.draw();
	}

	private drawItems(parent: HTMLElement, items: readonly OutlineItem[], prefix: string): void {
		const keys = rowKeys(items, prefix);
		items.forEach((it, i) => {
			const key = keys[i]!;
			const node = parent.createDiv({ cls: 'embed-outline-item', attr: { 'data-kind': it.kind, role: 'treeitem' } });
			const row = node.createDiv({ cls: 'embed-outline-row', attr: { tabindex: '0' } });
			const source = this.origins.get(it) ?? it;
			this.rowEls.set(source, row);
			this.rowKeyOf.set(source, key);
			const searching = this.query.trim().length > 0;
			const folded = !searching && this.folded.has(key);
			if (it.children.length) {
				node.setAttr('aria-expanded', folded ? 'false' : 'true');
				const toggle = row.createSpan({ cls: 'embed-outline-fold' });
				setIcon(toggle, folded ? 'chevron-right' : 'chevron-down');
				toggle.addEventListener('click', (evt) => {
					evt.stopPropagation();
					if (searching) return;
					if (this.folded.has(key)) this.folded.delete(key);
					else this.folded.add(key);
					this.draw();
				});
			} else {
				row.createSpan({ cls: 'embed-outline-fold embed-outline-spacer' });
			}
			const icon = it.locked ? 'lock' : ICONS[it.kind];
			if (icon) setIcon(row.createSpan({ cls: 'embed-outline-icon' }), icon);
			if (it.kind === 'callout' && it.calloutType) row.setAttr('data-callout', it.calloutType);
			row.createSpan({ cls: 'embed-outline-text', text: rowLabel(it) });
			if (it.words !== undefined) row.createSpan({ cls: 'embed-outline-words', text: fmt(it.words) });
			if (it.locked) setTooltip(row, 'Pro opens embeds inside embedded notes.');
			else if (it.depth > 0) setTooltip(row, `From ${it.path.replace(/\.md$/, '')}. ${Platform.isMacOS ? 'Cmd' : 'Ctrl'}+click opens that note.`);
			const go = (evt: MouseEvent | KeyboardEvent): void => {
				void this.plugin.jump(it, evt.metaKey || evt.ctrlKey);
			};
			row.addEventListener('click', go);
			row.addEventListener('keydown', (evt) => {
				if (evt.key === 'Enter' || evt.key === ' ') {
					evt.preventDefault();
					go(evt);
				}
			});
			if (it.children.length && !folded) this.drawItems(node.createDiv({ cls: 'embed-outline-children', attr: { role: 'group' } }), it.children, key);
		});
	}
}
