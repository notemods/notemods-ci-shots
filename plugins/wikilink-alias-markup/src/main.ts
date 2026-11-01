import { MarkdownView, Plugin } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { setupHello } from './hello/index';
import { SPONSORS, bindPro, isPro, onProChange, resetPro } from './pro';
import { DEFAULT_SETTINGS, WikilinkAliasMarkupSettingTab, effectiveOptions, normalizeSettings, type Options, type WikilinkAliasMarkupSettings } from './settings';
import { OBSIDIAN_MATH, ReadingView } from './reading';
import { aliasMarkupExtension, redrawViews } from './editor';
import WHATS_NEW from './whats-new.json';

/** How often to ask the license state whether a check is due. It sends a request only when signed in and due (7 days). */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;

export default class WikilinkAliasMarkupPlugin extends Plugin {
	settings: WikilinkAliasMarkupSettings = { ...DEFAULT_SETTINGS };
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	/** The Reading view post processor. Created in onload. */
	reading: ReadingView | null = null;
	private settingTab: WikilinkAliasMarkupSettingTab | null = null;

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
		this.register(onProChange(() => this.redrawAll()));
		this.settingTab = new WikilinkAliasMarkupSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		const options = (): Options => effectiveOptions(this.settings, isPro());
		const reading = new ReadingView(options);
		this.reading = reading;
		this.registerMarkdownPostProcessor((el, ctx) => reading.process(el, ctx));
		this.registerEditorExtension(aliasMarkupExtension({ app: this.app, options, math: OBSIDIAN_MATH }));

		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
			// Notes that were open before the plugin loaded show the markup at once.
			this.rerenderReading();
		});
	}

	onunload(): void {
		this.reading?.unload();
		this.reading = null;
		resetPro();
		// Reading views render again without the plugin, so no markup element stays behind (rule 11).
		this.rerenderReading();
	}

	/** Settings or Pro changed: redraw editors and Reading views. */
	redrawAll(): void {
		redrawViews();
		this.rerenderReading();
	}

	private rerenderReading(): void {
		this.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.getMode() === 'preview') view.previewMode.rerender(true);
		});
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<WikilinkAliasMarkupSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
