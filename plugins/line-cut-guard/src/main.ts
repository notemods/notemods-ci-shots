import { type Editor, Notice, Plugin } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { setupHello } from './hello/index';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { DEFAULT_SETTINGS, LineCutGuardSettingTab, normalizeSettings, type LineCutGuardSettings } from './settings';
import { ClipGuard, clearViews, lineCommand, viewFor, viewRegistry, type GuardOptions } from './clip';
import type { Kind } from './guard';
import WHATS_NEW from './whats-new.json';

/** How often to ask the license state whether a check is due. It sends a request only when signed in and due (7 days). */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;

export default class LineCutGuardPlugin extends Plugin {
	settings: LineCutGuardSettings = { ...DEFAULT_SETTINGS };
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	guard: ClipGuard | null = null;
	private settingTab: LineCutGuardSettingTab | null = null;
	/** False after unload starts: the guard then lets every cut and copy through. */
	private active = false;
	private readonly windows = new WeakSet<Window>();

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
		this.settingTab = new LineCutGuardSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		this.guard = new ClipGuard(this.app, () => this.options(), (text) => new Notice(text));
		this.active = true;
		this.registerEditorExtension(viewRegistry());
		this.attach(window);
		// Popout windows: the guard listens in each one.
		this.registerEvent(this.app.workspace.on('window-open', (_w, win) => this.attach(win)));

		this.addCommand({
			id: 'cut-selection-or-line',
			name: 'Cut selection or line',
			editorCallback: (editor: Editor) => void this.runLine(editor, 'cut'),
		});
		this.addCommand({
			id: 'copy-selection-or-line',
			name: 'Copy selection or line',
			editorCallback: (editor: Editor) => void this.runLine(editor, 'copy'),
		});

		this.app.workspace.onLayoutReady(() => {
			// Popout windows that were open before the plugin loaded.
			this.app.workspace.iterateAllLeaves((leaf) => this.attach(leaf.view.containerEl.win));
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
		});
	}

	onunload(): void {
		this.active = false;
		clearViews();
		resetPro();
	}

	/** Capture listeners on the document of win: they run before the editor and before Obsidian. Removed on unload. */
	private attach(win: Window): void {
		if (this.windows.has(win) || !this.guard) return;
		this.windows.add(win);
		const doc = win.document;
		this.registerDomEvent(doc, 'keydown', this.guard.onKeyDown, { capture: true });
		this.registerDomEvent(doc, 'cut', this.guard.onClipboard, { capture: true });
		this.registerDomEvent(doc, 'copy', this.guard.onClipboard, { capture: true });
	}

	/** The options that the guard reads on each cut and copy. */
	options(): GuardOptions {
		return { active: this.active, cut: this.settings.cut, copy: this.settings.copy, notice: this.settings.notice, pro: isPro() };
	}

	/** A setting changed: the guard forgets a first press, and the settings tab shows the change. */
	applySettings(): void {
		this.guard?.reset();
		this.settingTab?.update();
	}

	private async runLine(editor: Editor, kind: Kind): Promise<void> {
		const view = viewFor(editor, activeDocument);
		if (!view) {
			new Notice('Click in the text of a note first.');
			return;
		}
		const result = await lineCommand(view, kind, (text) => navigator.clipboard.writeText(text));
		if (result === 'marked') new Notice(`The command acts on text. For a selected image or table cells, use ${kind === 'cut' ? 'cut' : 'copy'} from the menu or the keyboard.`);
		if (result === 'no-clipboard') new Notice('Obsidian could not write to the clipboard. The note did not change.');
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<LineCutGuardSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
