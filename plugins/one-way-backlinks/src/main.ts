import { Plugin, type WorkspaceLeaf } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { setupHello } from './hello/index';
import { SPONSORS, bindPro, onProChange, resetPro } from './pro';
import { DEFAULT_SETTINGS, OneWayBacklinksSettingTab, normalizeSettings, type OneWayBacklinksSettings } from './settings';
import { OneWayBacklinksView, VIEW_TYPE } from './view';
import WHATS_NEW from './whats-new.json';

/** How often to ask the license state whether a check is due. It sends a request only when signed in and due (7 days). */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;

export default class OneWayBacklinksPlugin extends Plugin {
	settings: OneWayBacklinksSettings = { ...DEFAULT_SETTINGS };
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	private settingTab: OneWayBacklinksSettingTab | null = null;

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
		this.register(onProChange(() => this.refreshViews()));
		this.settingTab = new OneWayBacklinksSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		this.registerView(VIEW_TYPE, (leaf) => new OneWayBacklinksView(leaf, this));
		this.registerHoverLinkSource(VIEW_TYPE, { display: 'One-way Backlinks', defaultMod: true });
		this.addCommand({ id: 'open', name: 'Open pane', callback: () => void this.activateView() });

		this.app.workspace.onLayoutReady(() => {
			// The pane goes into the right sidebar one time, after the first install. A pane that the user closed stays closed.
			if (!this.settings.paneAdded) void this.addPaneOnce();
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
		});
	}

	onunload(): void {
		// Obsidian closes the views of this type, and each view removes its own events and timers in onClose.
		resetPro();
	}

	/** The open panes of this plugin. */
	views(): OneWayBacklinksView[] {
		return this.app.workspace
			.getLeavesOfType(VIEW_TYPE)
			.map((l) => l.view)
			.filter((v): v is OneWayBacklinksView => v instanceof OneWayBacklinksView);
	}

	/** Settings or Pro changed: compute and draw each pane again. */
	refreshViews(): void {
		for (const v of this.views()) v.refreshLists();
	}

	async activateView(): Promise<void> {
		const leaf = await this.ensureLeaf();
		if (!leaf) return;
		await this.app.workspace.revealLeaf(leaf);
		// A leaf that kept the type while the plugin was off can hold a placeholder view. Load the pane into it.
		if (!(leaf.view instanceof OneWayBacklinksView)) await leaf.setViewState({ type: VIEW_TYPE, active: true });
	}

	private async addPaneOnce(): Promise<void> {
		await this.ensureLeaf();
		this.settings.paneAdded = true;
		await this.saveSettings();
	}

	/** Makes sure the right sidebar has the pane, without showing it. */
	private async ensureLeaf(): Promise<WorkspaceLeaf | null> {
		const open = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
		if (open) return open;
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return null;
		await leaf.setViewState({ type: VIEW_TYPE, active: false });
		return leaf;
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<OneWayBacklinksSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
