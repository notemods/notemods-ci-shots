import { Notice, Plugin, SuggestModal, TFile, type App, type WorkspaceLeaf } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors, guardSponsorsPro } from './license/github-obsidian';
import { MAX_FROZEN } from './layout';
import { NoteTables, type NoteTableScope } from './note-tables';
import { END_CLASS, FROZEN_CLASS, LAST_CLASS, ROW_CLASS, installColumnPatch, type ColumnPatch } from './patch';
import { SPONSORS } from './pro';
import { DEFAULT_SETTINGS, effectiveFor, normalizeSettings, removeFile, renameFile, withFileChoice, type FreezeSettings } from './scope';
import { BasesFreezePanesSettingTab } from './settings';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

const SCOPE_ATTR = 'data-bfp-columns';
const LAST_ATTR = 'data-bfp-last';
/** How often to ask the license state whether a check is due. It sends a request only when signed in and due (7 days). */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;
const HEADER_CLASS = 'bfp-header';
const HEIGHT_PROP = '--bfp-embed-height';

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
		this.patch?.remove();
		this.patch = null;
		for (const el of this.marked) this.unmark(el);
		this.marked.clear();
		// Cells the patch marked are cleaned up here; the core table then lays them out on its next pass.
		for (const doc of this.documents()) {
			doc.querySelectorAll<HTMLElement>(`.${END_CLASS}`).forEach((el) => el.style.removeProperty('margin-inline-start'));
			doc.querySelectorAll(`.${FROZEN_CLASS}, .${LAST_CLASS}, .${ROW_CLASS}, .${END_CLASS}`).forEach((el) => el.removeClass(FROZEN_CLASS, LAST_CLASS, ROW_CLASS, END_CLASS));
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

	/** Frozen columns for the table inside el: the file of its tab, or the defaults for popovers. */
	columnsFor(el: HTMLElement): number {
		const scope = el.closest(`[${SCOPE_ATTR}]`);
		if (scope) return Number(scope.getAttribute(SCOPE_ATTR)) || 0;
		return effectiveFor(this.settings, null, this.isPro()).columns;
	}

	/** True when the last column of the table inside el is pinned to the end edge (Pro). */
	pinLastFor(el: HTMLElement): boolean {
		const scope = el.closest(`[${LAST_ATTR}]`);
		if (scope) return scope.getAttribute(LAST_ATTR) === 'true';
		return effectiveFor(this.settings, null, this.isPro()).last;
	}

	/** A chosen property stays visible even when it is not a leading column. */
	pinPropertyFor(el: HTMLElement): string | null {
		const scope = el.closest(`[${SCOPE_ATTR}]`);
		if (!this.settings.enabled || !this.isPro()) return null;
		const property = scope ? scope.getAttribute('data-bfp-property') ?? '' : this.settings.pinProperty;
		if (!property) return null;
		return /^(note|file|formula)\./.test(property) ? property : `note.${property}`;
	}

	/** Removes one file's choice (the list in the settings). */
	async forgetFileChoice(path: string): Promise<void> {
		const files = { ...this.settings.files };
		delete files[path];
		this.settings = { ...this.settings, files };
		await this.saveAndRefresh();
	}

	/** Writes the current choice onto every tab, then asks each table on screen to lay out its rows again. */
	refresh(): void {
		const scopes: NoteTableScope[] = [];
		const seen = new Set<HTMLElement>();
		this.app.workspace.iterateAllLeaves((leaf) => {
			this.markLeaf(leaf);
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
		el.setAttribute(LAST_ATTR, String(this.columnsSupported && eff.last));
		el.setAttribute('data-bfp-property', this.isPro() && this.settings.enabled && !this.settings.files[path ?? '']?.off ? this.settings.pinProperty : '');
		el.toggleClass(HEADER_CLASS, eff.header);
		el.setCssProps({ [HEIGHT_PROP]: `${this.settings.embedHeight}px` });
		this.marked.add(el);
		if (before !== state()) this.rerender(el);
	}

	private unmark(el: HTMLElement): void {
		el.removeAttribute(SCOPE_ATTR);
		el.removeAttribute(LAST_ATTR);
		el.removeAttribute('data-bfp-property');
		el.removeClass(HEADER_CLASS);
		el.style.removeProperty(HEIGHT_PROP);
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
		const off = this.settings.files[file.path]?.off === true;
		this.settings = withFileChoice(this.settings, file.path, { ...this.settings.files[file.path], off: !off });
		await this.saveAndRefresh();
		new Notice(off ? `Frozen panes on for ${file.basename}.` : `Frozen panes off for ${file.basename}.`);
	}

	private async setFileColumns(file: TFile, columns: number | null): Promise<void> {
		const current = this.settings.files[file.path] ?? {};
		this.settings = withFileChoice(this.settings, file.path, { off: current.off, columns: columns ?? undefined });
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
