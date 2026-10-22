import { Modal, Notice, Plugin, Setting, SuggestModal, TFile, type App, type WorkspaceLeaf } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors, guardSponsorsPro } from './license/github-obsidian';
import { MAX_FROZEN } from './layout';
import { NoteTables, type NoteTableScope } from './note-tables';
import { END_CLASS, FROZEN_CLASS, LAST_CLASS, ROW_CLASS, installColumnPatch, type ColumnPatch } from './patch';
import { SPONSORS } from './pro';
import { DEFAULT_SETTINGS, MAX_VIEWS, effectiveFor, fileChoiceOf, normalizeSettings, removeFile, renameFile, viewChoiceOf, withFileChoice, withoutFileLevel, withViewChoice, type FreezeSettings, type ViewChoice } from './scope';
import { BasesFreezePanesSettingTab } from './settings';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

const SCOPE_ATTR = 'data-bfp-columns';
const LAST_ATTR = 'data-bfp-last';
/** How often to ask the license state whether a check is due. It sends a request only when signed in and due (7 days). */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;
const HEADER_CLASS = 'bfp-header';
const HEIGHT_PROP = '--bfp-embed-height';
/** The file path of a tab, so a table can find the choice of its view. */
const PATH_ATTR = 'data-bfp-path';
/** The core sets this attribute on each Bases view element (checked in 1.13.4 and 1.14.4). */
const VIEW_NAME_ATTR = 'data-view-name';
const VIEW_SELECTOR = '.bases-view';
/** On a view element that has its own header choice. */
export const VIEW_HEADER_CLASS = 'bfp-view-header';
export const VIEW_NO_HEADER_CLASS = 'bfp-no-header';

/** The name of the view that a Bases view element shows, or null when the app gives none. */
export function viewNameOf(el: Element | null): string | null {
	const name = el?.getAttribute(VIEW_NAME_ATTR);
	return name ? name : null;
}

/** A view of an open file that the view command can change. */
export interface ViewTarget {
	file: TFile;
	view: string;
}

/** Files whose tables the plugin can freeze: base files and notes that embed bases. */
const isTableFile = (file: TFile | null): file is TFile => !!file && (file.extension === 'base' || file.extension === 'md');

export default class BasesFreezePanesPlugin extends Plugin {
	settings: FreezeSettings = { ...DEFAULT_SETTINGS };
	columnsSupported = true;
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	private settingTab: BasesFreezePanesSettingTab | null = null;
	private patch: ColumnPatch | null = null;
	private marked = new Set<HTMLElement>();
	private noteTables = new NoteTables();
	/** The last state written on each Bases view element, so a refresh redraws only the views that changed. */
	private viewStates = new WeakMap<HTMLElement, string>();
	/** One observer for each tab: the core changes the view name attribute when the user switches views. */
	private viewObservers = new Map<HTMLElement, MutationObserver>();

	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		// No request here: a request needs a GitHub sign in first (Settings, Pro, Sign in with GitHub).
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		this.register(
			pro.onChange(() => {
				this.refresh();
				this.settingTab?.update();
			}),
		);
		this.settingTab = new BasesFreezePanesSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		this.addCommand({
			id: 'toggle',
			name: 'Turn frozen panes on or off',
			callback: async () => {
				this.settings.enabled = !this.settings.enabled;
				await this.saveAndRefresh();
				new Notice(this.settings.enabled ? 'Frozen panes on.' : 'Frozen panes off.');
			},
		});
		this.addCommand({
			id: 'toggle-file',
			name: 'Turn frozen panes on or off for the current file',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!isTableFile(file)) return false;
				if (!checking) void this.toggleFile(file);
				return true;
			},
		});
		this.addCommand({
			id: 'set-file-columns',
			name: 'Set frozen columns for the current file',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!isTableFile(file)) return false;
				if (!checking) guardSponsorsPro(pro, () => new ColumnsModal(this.app, this.settings.columns, (columns) => void this.setFileColumns(file, columns)).open())();
				return true;
			},
		});

		this.addCommand({
			id: 'set-view',
			name: 'Set frozen panes for the current view',
			checkCallback: (checking) => {
				const target = this.currentViewTarget();
				if (!target) return false;
				if (!checking) new ViewChoiceModal(this.app, this, target).open();
				return true;
			},
		});

		this.app.workspace.onLayoutReady(() => {
			this.patch = installColumnPatch(
				this.app,
				(el) => this.columnsFor(el),
				(el) => this.pinLastFor(el),
				(el) => this.pinPropertyFor(el),
			);
			this.columnsSupported = this.patch !== null;
			this.refresh();
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
			this.registerEvent(this.app.workspace.on('layout-change', () => this.refresh()));
			this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.refresh()));
			this.registerEvent(this.app.workspace.on('file-open', () => this.refresh()));
		});
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				const next = renameFile(this.settings, oldPath, file.path);
				if (next === this.settings) return;
				this.settings = next;
				void this.saveAndRefresh();
			}),
		);
		// A new file at the same path must not get the choice of a deleted file.
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				const next = removeFile(this.settings, file.path);
				if (next === this.settings) return;
				this.settings = next;
				void this.saveAndRefresh();
			}),
		);
	}

	onunload(): void {
		this.noteTables.clear();
		for (const observer of this.viewObservers.values()) observer.disconnect();
		this.viewObservers.clear();
		this.patch?.remove();
		this.patch = null;
		for (const el of this.marked) this.unmark(el);
		this.marked.clear();
		// Cells the patch marked are cleaned up here; the core table then lays them out on its next pass.
		for (const doc of this.documents()) {
			doc.querySelectorAll<HTMLElement>(`.${END_CLASS}`).forEach((el) => el.style.removeProperty('margin-inline-start'));
			doc.querySelectorAll(`.${FROZEN_CLASS}, .${LAST_CLASS}, .${ROW_CLASS}, .${END_CLASS}`).forEach((el) => el.removeClass(FROZEN_CLASS, LAST_CLASS, ROW_CLASS, END_CLASS));
			doc.querySelectorAll(`.${VIEW_HEADER_CLASS}, .${VIEW_NO_HEADER_CLASS}`).forEach((el) => el.removeClass(VIEW_HEADER_CLASS, VIEW_NO_HEADER_CLASS));
			this.rerender(doc.body);
		}
	}

	/** Pro from the cached GitHub Sponsors answer. Never sends a request. */
	isPro(): boolean {
		return this.pro?.isPro() ?? false;
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async saveAndRefresh(): Promise<void> {
		await this.saveSettings();
		this.refresh();
	}

	async forgetFileChoices(): Promise<void> {
		this.settings = { ...this.settings, files: {} };
		await this.saveAndRefresh();
	}

	/**
	 * The file and view of the table inside el, when that view has its own choice. Else null, and the
	 * file choice applies. Without a view name the plugin does not guess.
	 */
	private viewScopeOf(el: HTMLElement): { path: string; view: string; viewEl: HTMLElement } | null {
		const viewEl = el.closest<HTMLElement>(VIEW_SELECTOR);
		const view = viewNameOf(viewEl);
		const path = el.closest(`[${PATH_ATTR}]`)?.getAttribute(PATH_ATTR);
		if (!viewEl || !view || !path) return null;
		return viewChoiceOf(fileChoiceOf(this.settings, path), view) ? { path, view, viewEl } : null;
	}

	/** Frozen columns for the table inside el: its view, the file of its tab, or the defaults for popovers. */
	columnsFor(el: HTMLElement): number {
		const viewEl = el.closest<HTMLElement>(VIEW_SELECTOR);
		// The table draws its rows here, so a view switch in the tab updates the header marks at once.
		if (viewEl) this.markView(viewEl);
		const view = this.viewScopeOf(el);
		if (view) return effectiveFor(this.settings, view.path, this.isPro(), view.view).columns;
		const scope = el.closest(`[${SCOPE_ATTR}]`);
		if (scope) return Number(scope.getAttribute(SCOPE_ATTR)) || 0;
		return effectiveFor(this.settings, null, this.isPro()).columns;
	}

	/** True when the last column of the table inside el is pinned to the end edge (Pro). */
	pinLastFor(el: HTMLElement): boolean {
		const view = this.viewScopeOf(el);
		if (view) return this.columnsSupported && effectiveFor(this.settings, view.path, this.isPro(), view.view).last;
		const scope = el.closest(`[${LAST_ATTR}]`);
		if (scope) return scope.getAttribute(LAST_ATTR) === 'true';
		return effectiveFor(this.settings, null, this.isPro()).last;
	}

	/** A chosen property stays visible even when it is not a leading column. */
	pinPropertyFor(el: HTMLElement): string | null {
		const scope = el.closest(`[${SCOPE_ATTR}]`);
		if (!this.settings.enabled || !this.isPro()) return null;
		const view = this.viewScopeOf(el);
		if (view && viewChoiceOf(fileChoiceOf(this.settings, view.path), view.view)?.off === true) return null;
		const property = scope ? scope.getAttribute('data-bfp-property') ?? '' : this.settings.pinProperty;
		if (!property) return null;
		return /^(note|file|formula)\./.test(property) ? property : `note.${property}`;
	}

	/** Removes the off switch and the column count of one file (the list in the settings). Its view choices stay. */
	async forgetFileChoice(path: string): Promise<void> {
		this.settings = withoutFileLevel(this.settings, path);
		await this.saveAndRefresh();
	}

	/** Removes the choice of one view (the list in the settings). */
	async forgetViewChoice(path: string, view: string): Promise<void> {
		this.settings = withViewChoice(this.settings, path, view, null);
		await this.saveAndRefresh();
	}

	/** Sets or removes (null) the choice of one view. Returns false when the file already has MAX_VIEWS view choices. */
	async setViewChoice(path: string, view: string, choice: ViewChoice | null): Promise<boolean> {
		const next = withViewChoice(this.settings, path, view, choice);
		if (next === this.settings && choice !== null) {
			new Notice(`This file already has choices for ${MAX_VIEWS} views. Delete one in the settings first.`);
			return false;
		}
		this.settings = next;
		await this.saveAndRefresh();
		return true;
	}

	/**
	 * The view of the active tab: the view of a base file, or the one named view embedded in a note.
	 * Null when the tab shows no named view, or when a note shows more than one view.
	 */
	currentViewTarget(): ViewTarget | null {
		const file = this.app.workspace.getActiveFile();
		if (!isTableFile(file)) return null;
		const leaf = this.app.workspace.getMostRecentLeaf();
		if (!leaf || (leaf.view as { file?: unknown }).file !== file) return null;
		const names = new Set<string>();
		leaf.view.containerEl.querySelectorAll(VIEW_SELECTOR).forEach((el) => {
			const name = viewNameOf(el);
			if (name) names.add(name);
		});
		const [view] = names;
		return names.size === 1 && view ? { file, view } : null;
	}

	/** Writes the current choice onto every tab, then asks each table on screen to lay out its rows again. */
	refresh(): void {
		const scopes: NoteTableScope[] = [];
		const seen = new Set<HTMLElement>();
		this.app.workspace.iterateAllLeaves((leaf) => {
			this.markLeaf(leaf);
			this.markViews(leaf.view.containerEl);
			this.observeViews(leaf.view.containerEl);
			seen.add(leaf.view.containerEl);
			const file = (leaf.view as { file?: unknown }).file;
			if (!(file instanceof TFile) || file.extension !== 'md') return;
			const eff = effectiveFor(this.settings, file.path, this.isPro());
			if (this.settings.freezeNoteTables && (eff.header || eff.columns > 0)) {
				scopes.push({ root: leaf.view.containerEl, header: eff.header, column: eff.columns > 0, height: this.settings.embedHeight });
			}
		});
		this.noteTables.sync(scopes);
		// Release the elements of closed tabs and replaced views, so the set does not keep their DOM.
		for (const el of this.marked) {
			if (seen.has(el)) continue;
			this.unmark(el);
			this.marked.delete(el);
		}
		for (const [el, observer] of this.viewObservers) {
			if (seen.has(el)) continue;
			observer.disconnect();
			this.viewObservers.delete(el);
		}
	}

	/** Marks every Bases view in a tab and redraws the views whose choice changed. */
	private markViews(root: HTMLElement): void {
		root.querySelectorAll<HTMLElement>(VIEW_SELECTOR).forEach((viewEl) => {
			if (this.markView(viewEl)) viewEl.dispatchEvent(new Event('scroll'));
		});
	}

	/**
	 * Writes the header choice of one view on its element. Returns true when the state changed.
	 * A view without its own choice has no view class, so the class of the tab applies.
	 */
	private markView(viewEl: HTMLElement): boolean {
		const view = this.viewScopeOf(viewEl);
		const eff = view ? effectiveFor(this.settings, view.path, this.isPro(), view.view) : null;
		const state = eff ? `${view?.path}|${view?.view}|${String(eff.header)}|${eff.columns}|${String(eff.last)}` : '';
		viewEl.toggleClass(VIEW_HEADER_CLASS, eff?.header === true);
		viewEl.toggleClass(VIEW_NO_HEADER_CLASS, eff?.header === false);
		if (this.viewStates.get(viewEl) === state) return false;
		this.viewStates.set(viewEl, state);
		return true;
	}

	/** Redraws a view when the core changes its name, for example when the user picks another view in the tab. */
	private observeViews(root: HTMLElement): void {
		if (this.viewObservers.has(root)) return;
		const Observer = root.ownerDocument.defaultView?.MutationObserver ?? MutationObserver;
		const observer = new Observer((records) => {
			for (const record of records) {
				const target = record.target as HTMLElement;
				// The core writes the attribute on each update of the view; only a new name needs a redraw.
				if (record.oldValue === target.getAttribute(VIEW_NAME_ATTR) || !target.matches?.(VIEW_SELECTOR)) continue;
				this.markView(target);
				target.dispatchEvent(new Event('scroll'));
			}
		});
		observer.observe(root, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: [VIEW_NAME_ATTR] });
		this.viewObservers.set(root, observer);
	}

	private markLeaf(leaf: WorkspaceLeaf): void {
		const el = leaf.view.containerEl;
		const file = (leaf.view as { file?: unknown }).file;
		const path = file instanceof TFile ? file.path : null;
		const eff = effectiveFor(this.settings, path, this.isPro());
		const columns = this.columnsSupported ? eff.columns : 0;
		const state = () => `${el.getAttribute(SCOPE_ATTR)}|${el.getAttribute(LAST_ATTR)}|${String(el.hasClass(HEADER_CLASS))}|${el.style.getPropertyValue(HEIGHT_PROP)}|${el.getAttribute('data-bfp-property')}`;
		const before = state();
		el.setAttribute(SCOPE_ATTR, String(columns));
		if (path === null) el.removeAttribute(PATH_ATTR);
		else el.setAttribute(PATH_ATTR, path);
		el.setAttribute(LAST_ATTR, String(this.columnsSupported && eff.last));
		el.setAttribute('data-bfp-property', this.isPro() && this.settings.enabled && !fileChoiceOf(this.settings, path)?.off ? this.settings.pinProperty : '');
		el.toggleClass(HEADER_CLASS, eff.header);
		el.setCssProps({ [HEIGHT_PROP]: `${this.settings.embedHeight}px` });
		this.marked.add(el);
		if (before !== state()) this.rerender(el);
	}

	private unmark(el: HTMLElement): void {
		el.removeAttribute(SCOPE_ATTR);
		el.removeAttribute(PATH_ATTR);
		el.removeAttribute(LAST_ATTR);
		el.removeAttribute('data-bfp-property');
		el.removeClass(HEADER_CLASS);
		el.style.removeProperty(HEIGHT_PROP);
		el.querySelectorAll(`.${VIEW_HEADER_CLASS}, .${VIEW_NO_HEADER_CLASS}`).forEach((view) => view.removeClass(VIEW_HEADER_CLASS, VIEW_NO_HEADER_CLASS));
	}

	/** A scroll event makes the core table pick its visible cells again, which runs the column patch. */
	private rerender(root: HTMLElement): void {
		root.querySelectorAll('.bases-view').forEach((view) => view.dispatchEvent(new Event('scroll')));
	}

	private documents(): Set<Document> {
		const docs = new Set<Document>([activeDocument]);
		this.app.workspace.iterateAllLeaves((leaf) => docs.add(leaf.view.containerEl.ownerDocument));
		return docs;
	}

	private async toggleFile(file: TFile): Promise<void> {
		const current = fileChoiceOf(this.settings, file.path);
		const off = current?.off === true;
		this.settings = withFileChoice(this.settings, file.path, { ...current, off: !off });
		await this.saveAndRefresh();
		new Notice(off ? `Frozen panes on for ${file.basename}.` : `Frozen panes off for ${file.basename}.`);
	}

	private async setFileColumns(file: TFile, columns: number | null): Promise<void> {
		const current = fileChoiceOf(this.settings, file.path) ?? {};
		this.settings = withFileChoice(this.settings, file.path, { ...current, columns: columns ?? undefined });
		await this.saveAndRefresh();
		const count = effectiveFor(this.settings, file.path, this.isPro()).columns;
		new Notice(`${file.basename}: ${count} frozen ${count === 1 ? 'column' : 'columns'}.`);
	}
}

interface ColumnsChoice {
	label: string;
	columns: number | null;
}

/** Picks 0 to 3 frozen columns for one file, or the default. */
class ColumnsModal extends SuggestModal<ColumnsChoice> {
	constructor(
		app: App,
		private readonly fallback: number,
		private readonly onPick: (columns: number | null) => void,
	) {
		super(app);
		this.setPlaceholder('Frozen columns for this file');
	}

	getSuggestions(query: string): ColumnsChoice[] {
		const choices: ColumnsChoice[] = [{ label: `Use the default (${this.fallback})`, columns: null }];
		for (let n = 0; n <= MAX_FROZEN; n++) choices.push({ label: `${n} frozen ${n === 1 ? 'column' : 'columns'}`, columns: n });
		const q = query.trim().toLowerCase();
		return choices.filter((c) => c.label.toLowerCase().includes(q));
	}

	renderSuggestion(choice: ColumnsChoice, el: HTMLElement): void {
		el.setText(choice.label);
	}

	onChooseSuggestion(choice: ColumnsChoice): void {
		this.onPick(choice.columns);
	}
}

const COLUMNS_FROM_FILE = 'file';

/** The choices for one view: on or off, the header row and the frozen columns (Pro). Each change is saved at once. */
export class ViewChoiceModal extends Modal {
	constructor(
		app: App,
		private readonly plugin: BasesFreezePanesPlugin,
		private readonly target: ViewTarget,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(`Frozen panes for the view ${this.target.view}`);
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private current(): ViewChoice {
		return { ...viewChoiceOf(fileChoiceOf(this.plugin.settings, this.target.file.path), this.target.view) };
	}

	private async save(choice: ViewChoice | null): Promise<void> {
		await this.plugin.setViewChoice(this.target.file.path, this.target.view, choice);
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		const { file, view } = this.target;
		const settings = this.plugin.settings;
		const choice = this.current();
		const pro = this.plugin.isPro();
		const fileColumns = effectiveFor(settings, file.path, pro).columns;
		contentEl.empty();
		contentEl.createEl('p', { text: `These choices apply to the view ${view} in ${file.name}. Other views use the file choice.`, cls: 'setting-item-description' });
		new Setting(contentEl)
			.setName('Freeze this view')
			.setDesc('Off leaves this view exactly as the app draws it.')
			.addToggle((toggle) =>
				toggle.setValue(choice.off !== true).onChange((on) => {
					void this.save({ ...choice, off: on ? undefined : true });
				}),
			);
		new Setting(contentEl)
			.setName('Freeze the header row')
			.setDesc('Off also removes the height cap of this view when a note embeds it.')
			.setDisabled(choice.off === true)
			.addToggle((toggle) =>
				toggle
					.setValue(choice.header ?? settings.freezeHeader)
					.setDisabled(choice.off === true)
					.onChange((on) => {
						void this.save({ ...choice, header: on });
					}),
			);
		new Setting(contentEl)
			.setName('Frozen columns')
			.setDesc(pro ? `From 0 to ${MAX_FROZEN} columns for this view.` : `Pro. Without pro, this view uses the file choice (${fileColumns}).`)
			.setDisabled(choice.off === true || !pro)
			.addDropdown((dropdown) => {
				dropdown.addOption(COLUMNS_FROM_FILE, `Use the file choice (${fileColumns})`);
				for (let n = 0; n <= MAX_FROZEN; n++) dropdown.addOption(String(n), `${n} frozen ${n === 1 ? 'column' : 'columns'}`);
				dropdown
					.setValue(choice.columns === undefined ? COLUMNS_FROM_FILE : String(choice.columns))
					.setDisabled(choice.off === true || !pro)
					.onChange((value) => {
						void this.save({ ...choice, columns: value === COLUMNS_FROM_FILE ? undefined : Number(value) });
					});
			});
		new Setting(contentEl).addButton((button) =>
			button.setButtonText('Use the file choice').onClick(() => {
				void this.plugin.setViewChoice(file.path, view, null).then(() => this.close());
			}),
		);
	}
}
