import { MarkdownView, Notice, Plugin, type Editor, type MarkdownFileInfo, type TFile } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { DEFAULT_SETTINGS, GfmHeadingSlugsSettingTab, normalizeSettings, type GfmHeadingSlugsSettings } from './settings';
import { SlugIndex } from './resolve';
import { ReadingView } from './reading';
import { LinkClicks, insertRewriteExtension, stats } from './editor';
import { PreviewModal, applyToEditor, applyVault, copyHeadingLink, planForEditor, planRows, planVault } from './commands';

/** How often to ask the license state whether a check is due. It sends a request only when signed in and due (7 days). */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;

export default class GfmHeadingSlugsPlugin extends Plugin {
	settings: GfmHeadingSlugsSettings = { ...DEFAULT_SETTINGS };
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	/** Slugs of each note from the metadata cache. Created in onload. */
	index: SlugIndex | null = null;
	/** Counters for the e2e tests: filterScans counts inserted-link scans. */
	readonly stats = stats;
	private reading: ReadingView | null = null;
	private settingTab: GfmHeadingSlugsSettingTab | null = null;
	private unloaded = false;

	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		this.unloaded = false;
		// No request here: a request needs a GitHub sign in first (Settings, Pro, Sign in with GitHub).
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		this.register(pro.onChange(() => this.settingTab?.update()));
		this.settingTab = new GfmHeadingSlugsSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		const index = new SlugIndex(this.app);
		this.index = index;
		const useSlugs = (): boolean => this.settings.useSlugs;

		const reading = new ReadingView(index, useSlugs);
		this.reading = reading;
		this.registerMarkdownPostProcessor((el, ctx) => reading.process(el, ctx));
		// The cache can update after Reading view drew a note. When its slugs changed, draw that note again.
		this.registerEvent(
			this.app.metadataCache.on('changed', (file) => {
				const before = reading.rendered.get(file.path);
				if (before === undefined || !useSlugs()) return;
				if (index.slugsOf(file).slugs.join('\n') !== before) this.rerenderReading(file.path);
			}),
		);
		this.registerEvent(this.app.vault.on('delete', (file) => reading.rendered.delete(file.path)));

		this.registerEditorExtension(insertRewriteExtension(index, { useSlugs, rewriteInserted: () => this.settings.rewriteInserted }));

		const clicks = new LinkClicks(index, useSlugs, (el) => this.sourcePathOf(el));
		this.registerDomEvent(document, 'mousedown', clicks.onMouseDown, { capture: true });
		this.registerDomEvent(document, 'click', clicks.onClick, { capture: true });

		this.addCommand({
			id: 'copy-github-heading-link',
			name: 'Copy GitHub-style link to the current heading',
			editorCheckCallback: (checking: boolean, editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
				const file = ctx.file;
				if (!file) return false;
				if (!checking) void copyHeadingLink(index, editor, file);
				return true;
			},
		});
		this.addCommand({
			id: 'convert-note-links',
			name: 'Convert heading links in this note to GitHub slugs',
			editorCheckCallback: (checking: boolean, editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
				const file = ctx.file;
				if (!file) return false;
				if (!checking) this.convertNote(editor, file);
				return true;
			},
		});
		this.addCommand({
			id: 'convert-vault-links',
			name: 'Convert heading links in all notes to GitHub slugs',
			callback: () => void this.convertVault(),
		});

		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
		});
	}

	onunload(): void {
		this.unloaded = true;
		resetPro();
		this.rerenderReading(null);
	}

	/** The note of the Reading view that holds el. Embeds and hover previews give null: their links keep the core click. */
	private sourcePathOf(el: HTMLElement): string | null {
		if (el.closest('.markdown-embed, .hover-popover, .popover')) return null;
		let path: string | null = null;
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (path === null && leaf.view instanceof MarkdownView && leaf.view.containerEl.contains(el)) path = leaf.view.file?.path ?? null;
		});
		return path;
	}

	/** Opens the preview of the convert plan for the open note. Convert applies it as one undo step. */
	convertNote(editor: Editor, file: TFile): void {
		const index = this.index;
		if (!index) return;
		const { text, items } = planForEditor(index, editor, file);
		new PreviewModal(this.app, 'Convert heading links in this note', planRows(items), items.length, () => {
			if (!applyToEditor(editor, text, items)) new Notice('The note changed. Run the command again.');
			else new Notice(`Converted ${items.length} link${items.length === 1 ? '' : 's'}.`);
		}).open();
	}

	/** Pro: preview of the count for each note, then one write for each note. */
	async convertVault(): Promise<void> {
		const index = this.index;
		if (!index) return;
		if (!isPro()) {
			new Notice('Converting all notes is a paid feature. See the plugin settings.');
			return;
		}
		const stop = (): boolean => this.unloaded;
		const plan = await planVault(this.app, index, stop);
		const rows = plan.files.map((f) => `${f.file.path}: ${f.count}`);
		new PreviewModal(this.app, 'Convert heading links in all notes', rows, plan.total, async () => {
			const n = await applyVault(this.app, index, plan, stop);
			new Notice(`Converted ${n} link${n === 1 ? '' : 's'} in ${plan.files.length} note${plan.files.length === 1 ? '' : 's'}.`);
		}).open();
	}

	/** Settings changed: draw the Reading views again. */
	refresh(): void {
		this.rerenderReading(null);
	}

	private rerenderReading(path: string | null): void {
		this.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.getMode() === 'preview' && (path === null || view.file?.path === path)) view.previewMode.rerender(true);
		});
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<GfmHeadingSlugsSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
