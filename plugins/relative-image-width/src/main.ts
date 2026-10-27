import { MarkdownView, Plugin, TFile, debounce } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { setupHello } from './hello/index';
import { PROPERTY_LEAD, SPONSORS, bindPro, isPro, onProChange, proNotice, resetPro } from './pro';
import { DEFAULT_SETTINGS, NOTE_PROPERTY, RelativeImageWidthSettingTab, effectiveOptions, normalizeSettings, type Options, type RelativeImageWidthSettings } from './settings';
import { readingProcessor } from './reading';
import { clearTracked } from './dom';
import { clearRules } from './rules';
import { redrawViews, relativeImageExtension, stats } from './editor';
import WHATS_NEW from './whats-new.json';

/** How often to ask the license state whether a check is due. It sends a request only when signed in and due (7 days). */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;
/** Wait after the last change of a setting before the views draw again. */
const REFRESH_DELAY_MS = 300;

export default class RelativeImageWidthPlugin extends Plugin {
	settings: RelativeImageWidthSettings = { ...DEFAULT_SETTINGS };
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	/** Pass counter of the Live Preview editors (end-to-end test of rule 10). */
	readonly stats = stats;
	private settingTab: RelativeImageWidthSettingTab | null = null;
	/** True after onunload. A Reading view watch that still waits checks it. */
	private unloaded = false;

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
		this.register(onProChange(() => this.refreshAll()));
		this.settingTab = new RelativeImageWidthSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		this.registerMarkdownPostProcessor(readingProcessor(() => (this.unloaded ? null : this.options())));
		this.registerEditorExtension(
			relativeImageExtension({
				options: () => this.options(),
				property: (path) => this.property(path),
			}),
		);
		// Pro: a change of the note property sizes the images of that note again.
		this.registerEvent(
			this.app.metadataCache.on('changed', (file, _data, cache) => this.onMetadataChanged(file, cache.frontmatter)),
		);

		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
			// Reading views that rendered before the plugin loaded.
			this.rerenderReading();
		});
	}

	onunload(): void {
		this.unloaded = true;
		this.refreshSoon.cancel();
		clearTracked();
		clearRules();
		resetPro();
		// The editor plugins remove their sizes in destroy(). Reading views render again without the plugin.
		this.rerenderReading();
	}

	options(): Options {
		return effectiveOptions(this.settings, isPro());
	}

	/** The note property image-width of a note, or undefined. */
	property(path: string | null): unknown {
		if (!path) return undefined;
		const file = this.app.vault.getFileByPath(path);
		const fm = file ? this.app.metadataCache.getFileCache(file)?.frontmatter : undefined;
		return fm ? (fm as Record<string, unknown>)[NOTE_PROPERTY] : undefined;
	}

	private lastProperty = new Map<string, string>();
	private propertyNoticeShown = false;

	/** Pro: a change of the note property sizes the images of that note again. A free user who sets the property in
	 * the open note gets the Pro notice, once in each session. */
	onMetadataChanged(file: TFile, fm: Record<string, unknown> | undefined): void {
		if (!this.propertyChanged(file, fm)) return;
		if (!isPro()) {
			if (!this.propertyNoticeShown && fm?.[NOTE_PROPERTY] != null && this.app.workspace.getActiveFile()?.path === file.path) {
				this.propertyNoticeShown = true;
				proNotice(PROPERTY_LEAD);
			}
			return;
		}
		redrawViews();
		this.rerenderReading(file.path);
	}

	/** True when the note property of this note changed since the last check. */
	private propertyChanged(file: TFile, fm: Record<string, unknown> | undefined): boolean {
		const now = JSON.stringify(fm?.[NOTE_PROPERTY] ?? null);
		const before = this.lastProperty.get(file.path) ?? 'null';
		if (now === 'null') this.lastProperty.delete(file.path);
		else this.lastProperty.set(file.path, now);
		return now !== before;
	}

	/** Settings or Pro changed: size the images in every editor and Reading view again. */
	refreshAll(): void {
		redrawViews();
		this.rerenderReading();
	}

	/** The same as refreshAll, once after a burst of changes (typing in the default size field). */
	readonly refreshSoon = debounce(() => this.refreshAll(), REFRESH_DELAY_MS, true);

	/** Renders the Reading views again: all of them, or only the views of one note. */
	private rerenderReading(path: string | null = null): void {
		this.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			if (!(view instanceof MarkdownView) || view.getMode() !== 'preview') return;
			if (path === null || view.file?.path === path) view.previewMode.rerender(true);
		});
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<RelativeImageWidthSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
