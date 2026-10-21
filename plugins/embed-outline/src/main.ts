import { MarkdownView, Notice, Plugin, TFile, type WorkspaceLeaf } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { buildOutline, toMarkdownList, type Outline, type OutlineItem, type OutlineOptions } from './outline';
import { SPONSORS, bindPro, isPro, onProChange, resetPro } from './pro';
import { DEFAULT_SETTINGS, EmbedOutlineSettingTab, normalizeSettings, type EmbedOutlineSettings } from './settings';
import { collect } from './source';
import { EmbedOutlineView, VIEW_TYPE } from './view';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

/** How often to ask the license state whether a check is due. It sends a request only when signed in and due (7 days). */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;
/** Wait after a note changes before the outline is built again. */
const REFRESH_MS = 300;

export default class EmbedOutlinePlugin extends Plugin {
	settings: EmbedOutlineSettings = { ...DEFAULT_SETTINGS };
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	private settingTab: EmbedOutlineSettingTab | null = null;
	/** The note the outline shows: the last Markdown note that was active. */
	private rootPath: string | null = null;
	private rootLeaf: WorkspaceLeaf | null = null;
	private last: Outline | null = null;
	private timer: number | null = null;
	private generation = 0;

	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		// No request here: a request needs a GitHub sign in first (Settings, Pro, Sign in with GitHub).
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		this.register(pro.onChange(() => this.settingTab?.update()));
		this.register(onProChange(() => this.scheduleRefresh(0)));
		this.settingTab = new EmbedOutlineSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		this.registerView(VIEW_TYPE, (leaf) => new EmbedOutlineView(leaf, this));

		this.addCommand({ id: 'open', name: 'Open the outline panel', callback: () => void this.activateView() });
		this.addCommand({
			id: 'copy-markdown',
			name: 'Copy the outline as a Markdown list',
			checkCallback: (checking) => {
				if (!this.last) return false;
				if (!checking) void this.copyOutline();
				return true;
			},
		});

		this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => this.onActiveLeaf(leaf)));
		this.registerEvent(this.app.workspace.on('file-open', () => this.onActiveLeaf(this.app.workspace.getMostRecentLeaf())));
		this.registerEvent(
			this.app.metadataCache.on('changed', (file) => {
				if (this.isWatched(file.path)) this.scheduleRefresh(REFRESH_MS);
			}),
		);
		this.registerEvent(this.app.vault.on('rename', (file, old) => this.onRename(file.path, old)));
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (file.path === this.rootPath) this.rootPath = null;
				if (this.isWatched(file.path)) this.scheduleRefresh(REFRESH_MS);
			}),
		);
		this.registerEvent(this.app.vault.on('create', () => this.scheduleRefresh(REFRESH_MS)));

		this.app.workspace.onLayoutReady(() => {
			this.onActiveLeaf(this.app.workspace.getMostRecentLeaf());
			void this.ensureLeaf();
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
		});
	}

	onunload(): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		resetPro();
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<EmbedOutlineSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** The options the outline uses now: Pro settings count only with Pro. */
	options(): OutlineOptions {
		const pro = isPro();
		const s = this.settings;
		return { callouts: s.callouts, listHeadings: s.listHeadings, maxDepth: pro ? s.depth : 1, words: pro && s.words, broken: pro && s.broken };
	}

	views(): EmbedOutlineView[] {
		return this.app.workspace.getLeavesOfType(VIEW_TYPE).flatMap((l) => (l.view instanceof EmbedOutlineView ? [l.view] : []));
	}

	refreshViews(): void {
		this.scheduleRefresh(0);
	}

	/** The outline last built, for commands and tests. */
	current(): Outline | null {
		return this.last;
	}

	private isWatched(path: string): boolean {
		return path === this.rootPath || (this.last?.paths.includes(path) ?? false);
	}

	private onActiveLeaf(leaf: WorkspaceLeaf | null): void {
		const view = leaf?.view;
		if (!(view instanceof MarkdownView) || !view.file) return;
		this.rootLeaf = leaf;
		if (view.file.path === this.rootPath) return;
		this.rootPath = view.file.path;
		this.scheduleRefresh(0);
	}

	private onRename(path: string, old: string): void {
		if (old === this.rootPath) this.rootPath = path;
		if (this.isWatched(old) || this.isWatched(path)) this.scheduleRefresh(REFRESH_MS);
	}

	scheduleRefresh(ms: number): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = null;
			void this.refresh();
		}, ms);
	}

	/** Builds the outline of the root note again and draws it in every open outline view. */
	async refresh(): Promise<Outline | null> {
		const gen = ++this.generation;
		const path = this.rootPath;
		const file = path ? this.app.vault.getFileByPath(path) : null;
		if (!file) {
			this.last = null;
			for (const v of this.views()) v.show(null);
			return null;
		}
		const opts = this.options();
		const src = await collect(this.app, file.path, opts.maxDepth);
		if (gen !== this.generation) return this.last;
		const outline = buildOutline(file.path, src, opts);
		this.last = outline;
		for (const v of this.views()) v.show(outline);
		return outline;
	}

	/** Opens the outline in the right sidebar and shows it. */
	async activateView(): Promise<void> {
		const leaf = await this.ensureLeaf();
		if (leaf) await this.app.workspace.revealLeaf(leaf);
	}

	/** Makes sure the right sidebar has an outline tab, without showing it. */
	private async ensureLeaf(): Promise<WorkspaceLeaf | null> {
		const open = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
		if (open) return open;
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return null;
		await leaf.setViewState({ type: VIEW_TYPE, active: false });
		return leaf;
	}

	/** The open tab that shows the root note, or a new one. */
	private async rootView(): Promise<MarkdownView | null> {
		const path = this.rootPath;
		if (!path) return null;
		const leaf = this.rootLeaf;
		if (leaf?.view instanceof MarkdownView && leaf.view.file?.path === path) return leaf.view;
		for (const l of this.app.workspace.getLeavesOfType('markdown')) {
			if (l.view instanceof MarkdownView && l.view.file?.path === path) return l.view;
		}
		const file = this.app.vault.getFileByPath(path);
		if (!file) return null;
		const fresh = this.app.workspace.getLeaf(false);
		await fresh.openFile(file);
		return fresh.view instanceof MarkdownView ? fresh.view : null;
	}

	/**
	 * Goes to a row. A row of the open note scrolls the note to its line. A row from an embedded note scrolls to the
	 * embed and then to the heading inside the embed. With newTab, a row from an embedded note opens that note.
	 */
	async jump(item: OutlineItem, newTab: boolean): Promise<void> {
		if (newTab && item.depth > 0) {
			const file = this.app.vault.getFileByPath(item.path);
			if (file instanceof TFile) await this.app.workspace.getLeaf('tab').openFile(file, { eState: { line: item.line } });
			return;
		}
		const view = await this.rootView();
		if (!view) return;
		this.app.workspace.setActiveLeaf(view.leaf, { focus: true });
		scrollToLine(view, item.rootLine);
		if (item.depth > 0 && item.kind === 'heading') window.requestAnimationFrame(() => window.requestAnimationFrame(() => scrollToEmbeddedHeading(view, item.text)));
	}

	/** Pro: copies the outline as a nested Markdown list with a link to each heading. */
	async copyOutline(): Promise<string | null> {
		if (!isPro()) {
			new Notice('Copying the outline is a pro feature. Sponsor on GitHub, then sign in from the plugin settings.');
			return null;
		}
		const o = this.last;
		if (!o) return null;
		const root = o.path;
		const text = toMarkdownList(o, {
			words: o.words !== undefined,
			linkText: (path) => {
				const f = this.app.vault.getFileByPath(path);
				return f ? this.app.metadataCache.fileToLinktext(f, root, true) : path.replace(/\.md$/, '');
			},
		});
		const rows = text.split('\n').filter(Boolean).length;
		try {
			await navigator.clipboard.writeText(text);
			new Notice(`Copied the outline: ${rows} ${rows === 1 ? 'row' : 'rows'}.`);
		} catch {
			new Notice('Could not write to the clipboard. Click in the app window and try again.');
		}
		return text;
	}
}

/** Scrolls a note to a line: the cursor moves there in the editor, the view scrolls there in reading view. */
function scrollToLine(view: MarkdownView, line: number): void {
	if (view.getMode() === 'preview') {
		view.previewMode.applyScroll(line);
		return;
	}
	const pos = { line, ch: 0 };
	view.editor.setCursor(pos);
	view.editor.scrollIntoView({ from: pos, to: pos }, true);
}

/** After a scroll to an embed: brings the embedded heading with this text into view, when the app has drawn it. */
function scrollToEmbeddedHeading(view: MarkdownView, text: string): void {
	const want = text.trim().toLowerCase();
	for (const el of Array.from(view.containerEl.querySelectorAll<HTMLElement>('.markdown-embed [data-heading]'))) {
		if ((el.getAttribute('data-heading') ?? '').trim().toLowerCase() !== want) continue;
		el.scrollIntoView({ block: 'center' });
		return;
	}
}
