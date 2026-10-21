import { Notice, Plugin, normalizePath, type TFile } from 'obsidian';
import { createGitHubSponsors } from './license/github-obsidian';
import type { SponsorsManager } from './license/index';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { DocumentIndex, exportResults, search, type SearchOptions, type SearchResult } from './search';
import { DEFAULT_SETTINGS, FinderSettingTab, normalizeSettings, rootAsEmpty, type FinderSettings } from './settings';
import { vaultStore } from './store';
import { FinderModal } from './modal';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

export default class EmbeddedTextFinderPlugin extends Plugin {
	settings: FinderSettings = { ...DEFAULT_SETTINGS, presets: [] };
	pro: SponsorsManager | null = null;
	readonly index = new DocumentIndex();
	readonly modals = new Set<FinderModal>();
	private active = false;
	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		this.active = true;
		this.settings = normalizeSettings(await this.loadData());
		if (!this.active) return;
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init(); this.pro = pro; bindPro(pro);
		const tab = new FinderSettingTab(this.app, this);
		this.addSettingTab(tab);
		this.register(pro.onChange(() => {
			tab.update();
			if (!isPro()) this.index.clear();
			for (const modal of this.modals) modal.updatePro();
		}));
		this.addCommand({ id: 'search', name: 'Find text in notes and embeds', callback: () => { this.openSearch(); } });
		this.addCommand({ id: 'search-active', name: 'Find text in the active note and its embeds', checkCallback: (checking) => {
			const file = this.app.workspace.getActiveFile();
			if (!file || file.extension !== 'md') return false;
			if (!checking) this.openSearch(true);
			return true;
		} });
		this.registerEvent(this.app.vault.on('modify', (file) => this.index.invalidate(file.path)));
		this.registerEvent(this.app.vault.on('delete', (file) => this.index.invalidate(file.path)));
		this.registerEvent(this.app.vault.on('rename', () => this.index.clear()));
		this.app.workspace.onLayoutReady(() => {
			if (!this.active) return;
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
		});
	}
	onunload(): void {
		this.active = false;
		for (const modal of [...this.modals]) modal.close();
		this.index.clear(); resetPro();
	}
	openSearch(activeOnly = false): FinderModal { const modal = new FinderModal(this, activeOnly); modal.open(); return modal; }
	async saveSettings(): Promise<void> { await this.saveData(this.settings); }
	async runSearch(options: SearchOptions): Promise<SearchResult> {
		return search(vaultStore(this.app, this.app.vault.getMarkdownFiles(), this.index, () => isPro() && this.settings.useIndex), { ...options, folder: normalizePath(options.folder) });
	}
	async savePreset(name: string, folder: string, query: string): Promise<boolean> {
		if (!isPro()) { this.needsPro(); return false; }
		if (!name.trim() || !query.trim()) return false;
		this.settings.presets = this.settings.presets.filter((p) => p.name !== name.trim());
		this.settings.presets.push({ name: name.trim(), folder: rootAsEmpty(normalizePath(folder)), query });
		this.settings.presets = this.settings.presets.slice(-50);
		await this.saveSettings(); return true;
	}
	async removePreset(name: string): Promise<boolean> {
		if (!isPro()) { this.needsPro(); return false; }
		this.settings.presets = this.settings.presets.filter((p) => p.name !== name);
		await this.saveSettings(); return true;
	}
	async setIndex(enabled: boolean): Promise<boolean> {
		if (enabled && !isPro()) { this.needsPro(); return false; }
		this.settings.useIndex = enabled;
		if (!enabled) this.index.clear();
		await this.saveSettings(); return true;
	}
	async export(result: SearchResult, query: string): Promise<TFile | null> {
		if (!isPro()) { this.needsPro(); return null; }
		let number = 1;
		let path = 'Embedded text results.md';
		while (this.app.vault.getAbstractFileByPath(path)) path = `Embedded text results ${++number}.md`;
		const file = await this.app.vault.create(normalizePath(path), exportResults(result, query));
		new Notice(`Saved ${file.path}`); return file;
	}
	needsPro(): void { new Notice('This is a pro feature. Sponsor on GitHub, then sign in from the plugin settings.'); }
}
