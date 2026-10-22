import { Plugin, TFile } from 'obsidian';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { fileOf, gutterExtension, refreshAll } from './editor';
import { MODES, type NumberMode } from './numbering';
import { SPONSORS, bindPro, isPro, onProChange, resetPro } from './pro';
import { DEFAULT_SETTINGS, VisualLineNumbersSettingTab, effectiveSettings, normalizeSettings, type VisualLineNumbersSettings } from './settings';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

/** How often to ask the license state whether a check is due. It sends a request only when signed in and due (7 days). */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;
/** The note property that Pro reads: visual-line-numbers: false hides the gutter in that note. */
export const NOTE_PROPERTY = 'visual-line-numbers';
const COLOR_VARS: [keyof VisualLineNumbersSettings, string][] = [
	['colorAbsolute', '--vln-color-absolute'],
	['colorRelative', '--vln-color-relative'],
	['colorHybrid', '--vln-color-hybrid'],
];

export default class VisualLineNumbersPlugin extends Plugin {
	settings: VisualLineNumbersSettings = { ...DEFAULT_SETTINGS };
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	private settingTab: VisualLineNumbersSettingTab | null = null;
	/** The array that Obsidian reads. Changing it and calling workspace.updateOptions applies the change. */
	private readonly extensions: Extension[] = [];
	private installed = false;

	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		// No request here: a request needs a GitHub sign in first (Settings, Pro, Sign in with GitHub).
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		this.register(onProChange(() => this.applySettings()));
		this.register(pro.onChange(() => this.settingTab?.update()));
		this.settingTab = new VisualLineNumbersSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		this.registerEditorExtension(this.extensions);
		this.registerEvent(this.app.metadataCache.on('changed', () => refreshAll()));
		this.registerEvent(this.app.workspace.on('window-open', (win) => this.applyColors([win.doc])));
		this.addCommand({ id: 'toggle', name: 'Toggle the number gutter', callback: () => void this.update({ enabled: !this.settings.enabled }) });
		this.addCommand({ id: 'cycle-mode', name: 'Cycle number mode', callback: () => void this.update({ mode: this.nextMode() }) });
		for (const mode of MODES) {
			this.addCommand({ id: `mode-${mode}`, name: `Use ${mode} numbers`, callback: () => void this.update({ mode, enabled: true }) });
		}
		this.applySettings();
		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
		});
	}

	onunload(): void {
		resetPro();
		this.extensions.length = 0;
		this.clearColors();
	}

	private nextMode(): NumberMode {
		return MODES[(MODES.indexOf(this.settings.mode) + 1) % MODES.length]!;
	}

	private async update(change: Partial<VisualLineNumbersSettings>): Promise<void> {
		this.settings = normalizeSettings({ ...this.settings, ...change });
		await this.saveSettings();
		this.applySettings();
	}

	/** Puts the settings into effect: installs or removes the gutter, sets the colors, redraws. */
	applySettings(): void {
		const want = this.settings.enabled;
		if (want !== this.installed) {
			this.extensions.length = 0;
			if (want) this.extensions.push(this.buildExtension());
			this.installed = want;
			this.app.workspace.updateOptions();
		} else {
			refreshAll();
		}
		this.applyColors();
	}

	private buildExtension(): Extension {
		return gutterExtension({
			settings: () => effectiveSettings(this.settings, isPro()),
			noteProperty: (view: EditorView) => this.noteProperty(view),
		});
	}

	private noteProperty(view: EditorView): unknown {
		const info = fileOf(view);
		const file = info ? this.app.vault.getAbstractFileByPath(info.path) : null;
		if (!(file instanceof TFile)) return undefined;
		return this.app.metadataCache.getFileCache(file)?.frontmatter?.[NOTE_PROPERTY] as unknown;
	}

	/** The main window and each pop-out window. A CSS variable on the body of one window does not reach another window. */
	private documents(): Set<Document> {
		const docs = new Set<Document>([document]);
		this.app.workspace.iterateAllLeaves((leaf) => {
			docs.add(leaf.view.containerEl.doc);
		});
		return docs;
	}

	/** Pro colors are CSS variables on the body of each window. Without Pro, or with no color chosen, the theme color shows. */
	private applyColors(docs: Iterable<Document> = this.documents()): void {
		for (const doc of docs) {
			for (const [key, name] of COLOR_VARS) {
				const value = this.settings[key];
				if (isPro() && typeof value === 'string' && value !== '') doc.body.style.setProperty(name, value);
				else doc.body.style.removeProperty(name);
			}
		}
	}

	private clearColors(): void {
		for (const doc of this.documents()) {
			for (const [, name] of COLOR_VARS) doc.body.style.removeProperty(name);
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<VisualLineNumbersSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
