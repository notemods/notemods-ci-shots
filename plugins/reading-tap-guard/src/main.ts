import { MarkdownView, Plugin, type WorkspaceWindow } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { setupHello } from './hello/index';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { DEFAULT_SETTINGS, ReadingTapGuardSettingTab, normalizeSettings, type ReadingTapGuardSettings } from './settings';
import { TapGuard, selectWordAt } from './guard';
import { effective } from './taps';
import WHATS_NEW from './whats-new.json';

/** How often to ask the license state whether a check is due. It sends a request only when signed in and due (7 days). */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;
/** Wait after a double tap before the action, as core does, so that the click of the second tap is done. */
const ACTION_DELAY_MS = 100;

export default class ReadingTapGuardPlugin extends Plugin {
	settings: ReadingTapGuardSettings = { ...DEFAULT_SETTINGS };
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	guard: TapGuard | null = null;
	private settingTab: ReadingTapGuardSettingTab | null = null;

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
		this.settingTab = new ReadingTapGuardSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		// Rule 10: the guard reads the settings and the Pro state at each event.
		const guard = new TapGuard(
			() => effective(this.settings.action, this.settings.interval, isPro()),
			(reading, x, y, win) => this.doubleTap(reading, x, y, win),
		);
		this.guard = guard;
		const add = (win: Window, type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', cb: (e: PointerEvent) => void, opts: AddEventListenerOptions): void => {
			this.registerDomEvent(win, type, cb, opts);
		};
		guard.attach(window, add);
		// Rule 11: each popout window gets the same listeners.
		this.registerEvent(this.app.workspace.on('window-open', (_ww: WorkspaceWindow, win: Window) => guard.attach(win, add)));
		this.register(() => guard.reset());

		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
		});
	}

	onunload(): void {
		this.guard = null;
		resetPro();
	}

	/** Runs the chosen action for a double tap that the plugin found (rules 6 and 8). */
	private doubleTap(reading: HTMLElement, x: number, y: number, win: Window): void {
		const action = this.settings.action;
		win.setTimeout(() => {
			if (!reading.isConnected) return;
			if (action === 'select-word') {
				selectWordAt(reading, x, y);
				return;
			}
			if (action !== 'edit') return;
			// As core does: keep Reading view while the user has text selected.
			const sel = win.getSelection();
			if (sel && !sel.isCollapsed) return;
			const leaf = this.app.workspace.getLeavesOfType('markdown').find((l) => l.view instanceof MarkdownView && l.view.containerEl.contains(reading));
			if (!leaf || !(leaf.view instanceof MarkdownView) || leaf.view.getMode() !== 'preview') return;
			const state = leaf.getViewState();
			void leaf.setViewState({ ...state, state: { ...state.state, mode: 'source' } });
		}, ACTION_DELAY_MS);
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<ReadingTapGuardSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.guard?.reset();
	}
}
