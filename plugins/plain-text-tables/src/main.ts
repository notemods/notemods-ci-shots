import { Notice, Plugin } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { setupHello } from './hello/index';
import { SPONSORS, bindPro, isPro, onProChange, resetPro } from './pro';
import { DEFAULT_SETTINGS, PlainTextTablesSettingTab, effectiveOptions, normalizeSettings, type PlainTextTablesSettings } from './settings';
import { plainTextTables, refresh, removeAll, type EditorOptions } from './editor';
import { resetCore } from './core';
import WHATS_NEW from './whats-new.json';

/** How often to ask the license state whether a check is due. It sends a request only when signed in and due (7 days). */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;

export default class PlainTextTablesPlugin extends Plugin {
	settings: PlainTextTablesSettings = { ...DEFAULT_SETTINGS };
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	private settingTab: PlainTextTablesSettingTab | null = null;
	/** False after unload starts: the editor part then shows no table as text. */
	private active = false;

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
		this.register(onProChange(() => refresh()));
		this.settingTab = new PlainTextTablesSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		this.active = true;
		this.registerEditorExtension(
			plainTextTables(
				() => this.options(),
				() => new Notice('This Obsidian version does not let the plugin show table text. Tables stay as Obsidian draws them.'),
			),
		);

		this.addCommand({
			id: 'toggle-table-text',
			name: 'Toggle table text',
			callback: async () => {
				this.settings.enabled = !this.settings.enabled;
				await this.saveSettings();
				this.applySettings();
				new Notice(this.settings.enabled ? 'Table text in Live Preview is on.' : 'Table text in Live Preview is off.');
			},
		});

		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
		});
	}

	onunload(): void {
		this.active = false;
		removeAll();
		resetCore();
		resetPro();
	}

	/** The options that the editor part reads on each transaction. */
	options(): EditorOptions {
		if (!this.active) return { enabled: false, align: false, monospace: false };
		return effectiveOptions(this.settings, isPro());
	}

	/** A setting changed: each editor applies it at once, and the settings tab shows it. */
	applySettings(): void {
		refresh();
		this.settingTab?.update();
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<PlainTextTablesSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
