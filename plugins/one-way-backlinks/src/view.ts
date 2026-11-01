import { ItemView, Keymap, MarkdownView, TFile, debounce, type HoverParent, type HoverPopover, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import { linkBackSuffix, splitBacklinks, type BacklinkRow, type BacklinkSplit, type ListMode } from './links';
import { effectiveHiddenFolders, LISTS, PRO_LEADS } from './settings';
import { isPro, proNotice } from './pro';
import type OneWayBacklinksPlugin from './main';

export const VIEW_TYPE = 'one-way-backlinks';

/** Wait after the last metadata, rename or delete event before the lists update. A burst gives one update. */
export const UPDATE_DELAY_MS = 250;

const EMPTY: Record<ListMode, string> = {
	'one-way': 'No one-way backlinks. Each note that links here is also linked from this note.',
	paired: 'No paired backlinks. This note links to none of the notes that link to it.',
};

export class OneWayBacklinksView extends ItemView implements HoverParent {
	hoverPopover: HoverPopover | null = null;
	private readonly plugin: OneWayBacklinksPlugin;
	private listMode: ListMode;
	/** Path of the note that the lists belong to. */
	private notePath: string | null = null;
	private lists: BacklinkSplit = { oneWay: [], paired: [] };
	/** Key of the drawn content. The DOM is not built again when nothing changed, so a click on a row is not lost. */
	private drawnKey = '';
	/** Link back writes in flight or done, as "current\u0000source". They clear when the pair is no longer one-way. */
	private readonly linkedBack = new Set<string>();
	private readonly scheduleUpdate = debounce(() => this.refreshLists(), UPDATE_DELAY_MS, true);
	/** For tests: how often the lists were computed and how often the DOM was built, and the last compute time. */
	computes = 0;
	draws = 0;
	lastComputeMs = 0;

	constructor(leaf: WorkspaceLeaf, plugin: OneWayBacklinksPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.listMode = plugin.settings.defaultList;
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'One-way backlinks';
	}

	getIcon(): string {
		return 'arrow-left-from-line';
	}

	getState(): Record<string, unknown> {
		return { ...super.getState(), mode: this.listMode };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const mode = (state as { mode?: unknown } | null)?.mode;
		if (mode === 'one-way' || mode === 'paired') this.listMode = mode;
		await super.setState(state, result);
		this.refreshLists();
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass('owb-view');
		const { metadataCache, vault, workspace } = this.app;
		// Each event handler belongs to this view and goes away when the view closes or the plugin unloads.
		this.registerEvent(metadataCache.on('resolve', () => this.scheduleUpdate()));
		this.registerEvent(metadataCache.on('resolved', () => this.scheduleUpdate()));
		this.registerEvent(vault.on('rename', () => this.scheduleUpdate()));
		this.registerEvent(vault.on('delete', () => this.scheduleUpdate()));
		// A new active note updates at once. The same note does not draw again (see drawnKey).
		this.registerEvent(workspace.on('file-open', () => this.refreshLists()));
		this.registerEvent(workspace.on('active-leaf-change', () => this.refreshLists()));
		this.refreshLists();
		await Promise.resolve();
	}

	async onClose(): Promise<void> {
		this.scheduleUpdate.cancel();
		this.linkedBack.clear();
		this.contentEl.empty();
		this.drawnKey = '';
		this.notePath = null;
		await Promise.resolve();
	}

	/** The list that shows now. */
	getListMode(): ListMode {
		return this.listMode;
	}

	setListMode(mode: ListMode): void {
		if (mode === this.listMode) return;
		this.listMode = mode;
		this.app.workspace.requestSaveLayout();
		this.refreshLists();
	}

	/** Computes the lists for the active note and draws them when they changed. */
	refreshLists(): void {
		this.scheduleUpdate.cancel();
		const file = this.app.workspace.getActiveFile();
		const path = file?.path ?? null;
		const start = performance.now();
		const hidden = effectiveHiddenFolders(this.plugin.settings, isPro());
		this.lists = splitBacklinks(this.app.metadataCache.resolvedLinks, path, hidden);
		this.lastComputeMs = performance.now() - start;
		this.computes++;
		const changedNote = path !== this.notePath;
		this.notePath = path;
		const oneWay = new Set(this.lists.oneWay.map((r) => r.path));
		for (const key of [...this.linkedBack]) {
			const [cur, src] = key.split('\u0000');
			if (cur !== path || !oneWay.has(src ?? '')) this.linkedBack.delete(key);
		}
		const key = JSON.stringify([path, this.listMode, isPro(), this.lists, [...this.linkedBack]]);
		if (key === this.drawnKey) return;
		this.drawnKey = key;
		this.drawLists(changedNote);
	}

	private drawLists(changedNote: boolean): void {
		const el = this.contentEl;
		// An update for the same note and list keeps the scroll position.
		const keepScroll = changedNote ? 0 : el.scrollTop;
		el.empty();
		this.draws++;
		const path = this.notePath;
		if (!path) {
			el.createDiv({ cls: 'owb-empty', text: 'Open a note to see its backlinks.' });
			return;
		}
		const header = el.createDiv({ cls: 'owb-header' });
		header.createSpan({ cls: 'owb-title', text: 'Backlinks of ' });
		header.createSpan({ cls: 'owb-note', text: this.app.vault.getFileByPath(path)?.basename ?? path });
		const toggle = el.createDiv({ cls: 'owb-toggle', attr: { role: 'group', 'aria-label': 'Backlinks to show' } });
		for (const mode of ['one-way', 'paired'] as const) {
			const rows = mode === 'one-way' ? this.lists.oneWay : this.lists.paired;
			const btn = toggle.createEl('button', { cls: 'owb-mode', attr: { 'data-mode': mode, 'aria-pressed': String(mode === this.listMode) } });
			if (mode === this.listMode) btn.addClass('is-active');
			btn.createSpan({ cls: 'owb-mode-label', text: LISTS[mode] });
			btn.createSpan({ cls: 'owb-mode-count', text: String(rows.length) });
			btn.addEventListener('click', () => this.setListMode(mode));
		}
		const rows = this.listMode === 'one-way' ? this.lists.oneWay : this.lists.paired;
		const list = el.createDiv({ cls: 'owb-list', attr: { 'data-mode': this.listMode } });
		if (!rows.length) list.createDiv({ cls: 'owb-empty', text: EMPTY[this.listMode] });
		for (const row of rows) this.drawRow(list, row, path);
		el.scrollTop = keepScroll;
	}

	private drawRow(list: HTMLElement, row: BacklinkRow, current: string): void {
		const item = list.createDiv({ cls: 'owb-row', attr: { tabindex: '0', 'data-path': row.path } });
		const text = item.createDiv({ cls: 'owb-row-text' });
		text.createDiv({ cls: 'owb-name', text: row.name });
		if (row.folder) text.createDiv({ cls: 'owb-folder', text: row.folder });
		item.createSpan({ cls: 'owb-count', text: String(row.count), attr: { 'aria-label': row.count === 1 ? '1 link' : `${row.count} links` } });
		if (this.listMode === 'one-way') {
			const key = `${current}\u0000${row.path}`;
			const done = this.linkedBack.has(key);
			const btn = item.createEl('button', { cls: 'owb-link-back', text: done ? 'Linked' : 'Link back', attr: { 'aria-label': `Add a link to ${row.name} at the end of this note` } });
			if (done) btn.disabled = true;
			btn.addEventListener('click', (evt) => {
				evt.preventDefault();
				evt.stopPropagation();
				void this.linkBack(current, row.path);
			});
		}
		item.addEventListener('click', (evt) => void this.openNote(row.path, evt));
		item.addEventListener('keydown', (evt) => {
			if (evt.key !== 'Enter' || evt.target !== item) return;
			evt.preventDefault();
			void this.openNote(row.path, evt);
		});
		item.addEventListener('mouseover', (event) => {
			this.app.workspace.trigger('hover-link', { event, source: VIEW_TYPE, hoverParent: this, targetEl: item, linktext: row.path, sourcePath: current });
		});
	}

	private async openNote(path: string, evt: MouseEvent | KeyboardEvent): Promise<void> {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return;
		await this.app.workspace.getLeaf(Keymap.isModEvent(evt)).openFile(file);
	}

	/** Pro: adds "- [[source]]" at the end of the current note. In an open editor through the editor, else through vault.process. */
	async linkBack(currentPath: string, sourcePath: string): Promise<void> {
		if (!isPro()) {
			proNotice(PRO_LEADS.linkBack);
			return;
		}
		const key = `${currentPath}\u0000${sourcePath}`;
		if (this.linkedBack.has(key)) return;
		const current = this.app.vault.getFileByPath(currentPath);
		const source = this.app.vault.getFileByPath(sourcePath);
		if (!(current instanceof TFile) || !(source instanceof TFile)) return;
		this.linkedBack.add(key);
		this.drawnKey = '';
		this.refreshLists();
		const link = this.app.fileManager.generateMarkdownLink(source, current.path);
		const editorView = this.app.workspace
			.getLeavesOfType('markdown')
			.map((l) => l.view)
			.find((v): v is MarkdownView => v instanceof MarkdownView && v.file?.path === current.path && v.getMode() === 'source');
		try {
			if (editorView) {
				// The open editor may hold text that is not saved yet. Write through it, so that text stays.
				const editor = editorView.editor;
				const last = editor.lastLine();
				const end = { line: last, ch: editor.getLine(last).length };
				editor.replaceRange(linkBackSuffix(editor.getValue(), link), end);
			} else {
				await this.app.vault.process(current, (text) => text + linkBackSuffix(text, link));
			}
		} catch (err) {
			this.linkedBack.delete(key);
			this.drawnKey = '';
			this.refreshLists();
			console.error('one-way-backlinks: link back failed', err);
		}
	}
}
