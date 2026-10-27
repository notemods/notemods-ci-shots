import { MarkdownRenderChild, Notice, Plugin, type TFile } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { SPONSORS, bindPro, resetPro } from './pro';
import { DEFAULT_SETTINGS, PocketMarkwhenSettingTab, normalizeSettings, type PocketMarkwhenSettings } from './settings';
import { TimelinePanel } from './panel';
import { FORMAT_NAME } from './labels';
import { PocketMarkwhenView, VIEW_ID } from './view';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

export default class PocketMarkwhenPlugin extends Plugin {
	settings: PocketMarkwhenSettings = { ...DEFAULT_SETTINGS, savedFilters: [] };
	pro: SponsorsManager | null = null;
	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init(); this.pro = pro; bindPro(pro);
		const tab = new PocketMarkwhenSettingTab(this.app, this);
		this.addSettingTab(tab);
		this.register(pro.onChange(() => tab.update()));
		this.registerView(VIEW_ID, (leaf) => new PocketMarkwhenView(leaf, this));
		try { this.registerExtensions(['mw'], VIEW_ID); }
		catch { new Notice('Another view has registered .mw files. Use Open current file as Markwhen timeline.'); }
		this.registerMarkdownCodeBlockProcessor('mw', (source, el, ctx) => {
			const child = new MarkdownRenderChild(el);
			ctx.addChild(child);
			child.addChild(new TimelinePanel(el.createDiv(), this, [{ source, path: ctx.sourcePath }]));
		});
		this.addCommand({ id: 'open-timeline', name: `Open current file as ${FORMAT_NAME} timeline`, checkCallback: (checking) => {
			const file = this.app.workspace.getActiveFile();
			if (!file || file.extension !== 'mw') return false;
			if (!checking) void this.openTimeline(file);
			return true;
		} });
		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
		});
	}
	onunload(): void { resetPro(); }
	async openTimeline(file: TFile): Promise<void> {
		const leaf = this.app.workspace.getMostRecentLeaf() ?? this.app.workspace.getLeaf(true);
		await leaf.setViewState({ type: VIEW_ID, state: { file: file.path }, active: true });
	}
	async loadSettings(): Promise<void> { this.settings = normalizeSettings(await this.loadData() as Partial<PocketMarkwhenSettings> | null); }
	async saveSettings(): Promise<void> { await this.saveData(this.settings); }
}
