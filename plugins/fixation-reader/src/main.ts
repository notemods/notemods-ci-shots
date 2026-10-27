import { MarkdownView, Plugin, getAllTags, type MarkdownPostProcessorContext } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import type { Extension } from '@codemirror/state';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { DEFAULT_SETTINGS, FixationReaderSettingTab, normalizeSettings, type FixationReaderSettings } from './settings';
import { clearSection, processSection } from './reading';
import { enabledFor } from './rules';
import { fixationExtension } from './editor';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

export default class FixationReaderPlugin extends Plugin {
	settings: FixationReaderSettings = { ...DEFAULT_SETTINGS };
	pro: SponsorsManager | null = null;
	private tab: FixationReaderSettingTab | null = null;
	private extensions: Extension[] = [];
	private active = new Map<string, boolean>();
	private unloaded = false;

	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		this.tab = new FixationReaderSettingTab(this.app, this);
		this.addSettingTab(this.tab);
		this.register(pro.onChange(() => { this.tab?.update(); this.refreshViews(); }));
		this.registerMarkdownPostProcessor((el, ctx) => this.process(el, ctx), 100);
		this.extensions.push(fixationExtension(this));
		this.registerEditorExtension(this.extensions);
		this.addCommand({ id: 'toggle', name: 'Turn fixation on or off', callback: () => { void this.toggle(); } });
		this.registerEvent(this.app.metadataCache.on('changed', (file) => this.onMetadataChanged(file.path)));
		this.registerEvent(this.app.vault.on('rename', () => this.refreshViews()));
		this.app.workspace.onLayoutReady(() => {
			this.refreshViews();
			void pro.refresh();
			this.registerInterval(window.setInterval(() => { void pro.refresh(); }, 6 * 60 * 60 * 1000));
		});
	}

	activeFor(path: string, frontmatter?: unknown): boolean {
		const cache = this.app.metadataCache.getCache(path);
		return enabledFor(this.settings, isPro(), path, cache ? getAllTags(cache) ?? [] : [], frontmatter ?? cache?.frontmatter);
	}
	/** Redraw a note only when its rule result changes. A typing pause must not redraw each open editor. */
	onMetadataChanged(path: string): void {
		const active = this.activeFor(path);
		if (this.active.get(path) === active) return;
		this.active.set(path, active);
		this.refreshViews(path);
	}
	process(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
		processSection(el, this.settings, !this.unloaded && this.activeFor(ctx.sourcePath, ctx.frontmatter as unknown), isPro());
		if (!el.isConnected && el.querySelector('[data-fixation-reader]')) this.recheck(el, 10);
	}
	/** Live Preview renders callouts and tables before it attaches them. Check the place again after the attach. */
	private recheck(el: HTMLElement, tries: number): void {
		el.win.requestAnimationFrame(() => {
			if (!el.isConnected) {
				if (tries > 1) this.recheck(el, tries - 1);
				return;
			}
			if (el.closest('.markdown-source-view')) clearSection(el);
		});
	}
	async loadSettings(): Promise<void> { this.settings = normalizeSettings(await this.loadData()); }
	async saveSettings(): Promise<void> {
		this.settings = normalizeSettings(this.settings);
		await this.saveData(this.settings);
		this.refreshViews();
	}
	async toggle(): Promise<void> { this.settings.enabled = !this.settings.enabled; await this.saveSettings(); }

	refreshViews(path?: string): void {
		if (!path) this.active.clear();
		this.extensions.length = 0;
		this.extensions.push(fixationExtension(this));
		this.app.workspace.updateOptions();
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView && (!path || leaf.view.file?.path === path)) leaf.view.previewMode.rerender(true);
		});
	}
	/** Reading view keeps off-screen sections out of the DOM. Render each note again so those sections also lose their marks. */
	onunload(): void {
		this.unloaded = true;
		resetPro();
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (!(leaf.view instanceof MarkdownView)) return;
			clearSection(leaf.view.previewMode.containerEl);
			leaf.view.previewMode.rerender(true);
		});
	}
}
