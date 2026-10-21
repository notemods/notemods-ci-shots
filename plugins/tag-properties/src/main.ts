import { debounce, getAllTags, Plugin, type TFile } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { bindPro, isPro, SPONSORS } from './pro';
import { DEFAULT_SETTINGS, normalizeSettings, TagPropertiesSettingTab, type TagPropertiesSettings } from './settings';
import { activeProperties, buildIndex, type NoteTags, type TagRow } from './tags';
import { TagPropertiesView, VIEW_TYPE } from './view';

export default class TagPropertiesPlugin extends Plugin {
	settings: TagPropertiesSettings = { ...DEFAULT_SETTINGS };
	pro: SponsorsManager | null = null;
	private indexed: TagRow[] | null = null;
	private currentPath = '';
	private stopped = false;
	async onload(): Promise<void> {
		await this.loadSettings();
		this.pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		this.pro.init();
		bindPro(this.pro);
		this.register(this.pro.onChange(() => this.refresh()));
		this.registerView(VIEW_TYPE, (leaf) => new TagPropertiesView(leaf, this));
		this.addSettingTab(new TagPropertiesSettingTab(this.app, this));
		this.addCommand({ id: 'open-view', name: 'Open custom tags', callback: () => this.openView() });
		this.addRibbonIcon('tags', 'Open tag properties', () => { void this.openView(); });
		const refresh = debounce(() => this.refresh(), 250, true);
		this.registerEvent(this.app.metadataCache.on('changed', () => refresh()));
		this.registerEvent(this.app.metadataCache.on('resolved', () => refresh()));
		this.registerEvent(this.app.vault.on('rename', () => refresh()));
		this.registerEvent(this.app.vault.on('delete', () => refresh()));
		this.registerEvent(this.app.workspace.on('file-open', (file) => {
			if (file?.extension === 'md') this.currentPath = file.path;
			refresh();
		}));
		this.register(() => refresh.cancel());
		this.registerInterval(window.setInterval(() => { void this.pro?.refresh(); }, 6 * 60 * 60 * 1000));
		this.app.workspace.onLayoutReady(() => {
			if (this.stopped) return;
			void this.pro?.refresh();
			this.refresh();
		});
	}
	onunload(): void { this.stopped = true; bindPro(null); }
	isPro(): boolean { return isPro(); }
	properties(): string[] { return activeProperties(this.settings.properties, this.isPro()); }
	includeCore(): boolean { return this.isPro() && this.settings.includeCore; }
	private readNote(file: TFile): NoteTags {
		const cache = this.app.metadataCache.getFileCache(file);
		return { path: file.path, frontmatter: cache?.frontmatter ?? {}, coreTags: cache ? getAllTags(cache) ?? [] : [] };
	}
	currentNote(): NoteTags | null {
		const active = this.app.workspace.getActiveFile();
		if (active?.extension === 'md') this.currentPath = active.path;
		const file = this.app.vault.getFileByPath(this.currentPath);
		return file ? this.readNote(file) : null;
	}
	index(): TagRow[] {
		this.indexed ??= buildIndex(this.app.vault.getMarkdownFiles().map((file) => this.readNote(file)), this.properties(), this.includeCore());
		return this.indexed;
	}
	refresh(): void {
		this.indexed = null;
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) if (leaf.view instanceof TagPropertiesView) leaf.view.render();
	}
	async openView(): Promise<void> {
		this.currentNote();
		let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
		if (!leaf) {
			leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
		}
		await this.app.workspace.revealLeaf(leaf);
	}
	async loadSettings(): Promise<void> { this.settings = normalizeSettings(await this.loadData() as Partial<TagPropertiesSettings> | null); }
}
