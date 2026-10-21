import { Notice, Plugin } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { SPONSORS, bindPro, isPro, onProChange, resetPro } from './pro';
import { DEFAULT_SETTINGS, HrFoldStopSettingTab, effectiveRuleOf, normalizeSettings, type HrFoldStopSettings } from './settings';
import { expandFolds, foldStopExtension, notePathOf } from './extension';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

/** How often to ask the license state whether a check is due. It sends a request only when signed in and due (7 days). */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;

export default class HrFoldStopPlugin extends Plugin {
	settings: HrFoldStopSettings = { ...DEFAULT_SETTINGS };
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	readonly editorViews = new Set<EditorView>();
	private readonly noteOverrides = new Map<string, boolean | undefined>();
	readonly restoredNotes = new Set<string>();
	private settingTab: HrFoldStopSettingTab | null = null;
	private removeProListener: (() => void) | null = null;

	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		// No request here: a request needs a GitHub sign in first (Settings, Pro, Sign in with GitHub).
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		this.settingTab = new HrFoldStopSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		// The extension reads settings through this closure on every fold request.
		// The path comes from the editor state, not from the active file, so a
		// background pane still uses its own note for folder rules and overrides.
		this.registerEditorExtension(foldStopExtension((path) => this.editorConfig(path), this.editorViews));
		// Registered cleanup runs before the editor extension is removed.
		this.register(() => this.reconfigure());

		// Each check and each failed retry calls the listener, also with no change. Expand folds only when Pro changes.
		let wasPro = isPro();
		this.removeProListener = onProChange(() => {
			const nowPro = isPro();
			if (nowPro !== wasPro) this.reconfigure();
			wasPro = nowPro;
			this.settingTab?.update();
		});

		this.addCommand({
			id: 'restore-normal-folding',
			name: 'Restore normal folding in this note',
			editorCallback: (editor, info) => {
				editor.exec('unfoldAll');
				if (info.file) {
					const path = info.file.path;
					this.restoredNotes.add(path);
					// Other panes of this note only. Folds in other notes stay.
					for (const view of this.editorViews) if (notePathOf(view.state) === path) expandFolds(view);
				}
				new Notice('Normal folding for this note until settings change or the plugin reloads.');
			},
		});

		this.registerEvent(this.app.metadataCache.on('changed', file => {
			const value = this.noteOverrideFor(file.path);
			if (this.noteOverrides.get(file.path) !== value) {
				for (const view of this.editorViews) if (notePathOf(view.state) === file.path) expandFolds(view);
			}
			this.noteOverrides.set(file.path, value);
			this.settingTab?.refreshEffectiveRule();
		}));
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			if (this.restoredNotes.delete(oldPath)) this.restoredNotes.add(file.path);
			this.noteOverrides.delete(oldPath);
		}));
		this.registerEvent(this.app.workspace.on('file-open', () => this.settingTab?.refreshEffectiveRule()));

		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
		});
	}

	onunload(): void {
		this.removeProListener?.();
		this.removeProListener = null;
		for (const view of this.editorViews) expandFolds(view);
		resetPro();
	}

	/** Read the current settings for this editor. */
	editorConfig(path: string) {
		const noteOverride = this.noteOverrideFor(path);
		if (!this.noteOverrides.has(path)) this.noteOverrides.set(path, noteOverride);
		return {
			enabled: !this.restoredNotes.has(path),
			rule: effectiveRuleOf(this.settings),
			noteOverride,
		};
	}

	/** Pro note override: true, false, or undefined when the note has no valid value. */
	noteOverrideFor(path: string): boolean | undefined {
		if (!isPro() || !this.settings.overrideProperty) return undefined;
		const file = this.app.vault.getFileByPath(path);
		if (!file) return undefined;
		const cache = this.app.metadataCache.getFileCache(file);
		const frontmatter: Record<string, unknown> | undefined = cache?.frontmatter;
		const value: unknown = frontmatter?.[this.settings.overrideProperty];
		return typeof value === 'boolean' ? value : undefined;
	}

	/** Expand stored ranges before the next fold uses the new rule. */
	reconfigure(): void {
		for (const view of this.editorViews) expandFolds(view);
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<HrFoldStopSettings> | null);
	}

	async saveSettings(): Promise<void> {
		this.restoredNotes.clear();
		await this.saveData(this.settings);
		this.reconfigure();
		this.settingTab?.refreshEffectiveRule();
	}
}
