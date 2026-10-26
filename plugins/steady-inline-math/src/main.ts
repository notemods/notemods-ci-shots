import { Notice, Plugin, MarkdownView, editorInfoField, editorLivePreviewField } from 'obsidian';
import type { EditorState } from '@codemirror/state';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { GuardController } from './guard';
import { folderEnabled } from './math';
import { EquationPanel, PANEL_ID } from './panel';
import { PRO_LABEL, SPONSORS, bindPro, isPro, resetPro, proNotice } from './pro';
import { DEFAULT_SETTINGS, SteadyInlineMathSettingTab, normalizeSettings, type SteadyInlineMathSettings } from './settings';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

export default class SteadyInlineMathPlugin extends Plugin {
	settings: SteadyInlineMathSettings = { ...DEFAULT_SETTINGS };
	pro: SponsorsManager | null = null;
	guard = new GuardController({ focusOnly: true, eligible: (state) => this.settings.enabled && state.field(editorLivePreviewField, false) === true && folderEnabled(this.filePath(state), this.settings.folderRules, isPro()), onLost: (state, clean) => this.queueRestore(this.filePath(state), state.doc.toString(), clean) });
	private readonly lost = new Map<string, { guarded: string; clean: string; until: number }>();
	private panelPath = '';
	readonly panels = new Set<EquationPanel>();
	filePath(state: EditorState): string { return state.field(editorInfoField, false)?.file?.path ?? ''; }
	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init(); this.pro = pro; bindPro(pro);
		const tab = new SteadyInlineMathSettingTab(this.app, this);
		this.addSettingTab(tab);
		this.register(pro.onChange(() => { tab.update(); this.guard.refresh(); this.renderPanels(); }));
		// Clean before editor extension removal for either cleanup callback order.
		this.register(() => this.guard.stop());
		this.registerEditorExtension(this.guard.extension);
		this.register(() => this.guard.stop());
		this.registerView(PANEL_ID, (leaf) => new EquationPanel(leaf, this));
		this.addCommand({ id: 'toggle-guard', name: 'Toggle inline math guard', callback: () => void this.toggleGuard() });
		this.addCommand({ id: 'show-equations', name: `Show equations (${PRO_LABEL})`, callback: () => void this.showEquations() });
		this.registerEvent(this.app.vault.on('modify', (file) => void this.restoreLost(file.path)));
		this.registerEvent(this.app.workspace.on('editor-change', () => this.renderPanels()));
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.renderPanels()));
		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
		});
	}
	onunload(): void { this.guard.stop(); resetPro(); }
	/** A tab close can save the guarded source after cleanup. Replace it only in a closed note that holds exactly that source. */
	queueRestore(path: string, guarded: string, clean: string): void {
		if (!path) return;
		this.lost.set(path, { guarded, clean, until: Date.now() + 10_000 });
		void this.restoreLost(path);
	}
	async restoreLost(path: string): Promise<void> {
		const entry = this.lost.get(path);
		if (!entry) return;
		const file = this.app.vault.getFileByPath(path);
		if (!file || Date.now() > entry.until) { this.lost.delete(path); return; }
		if (this.app.workspace.getLeavesOfType('markdown').some((leaf) => leaf.view instanceof MarkdownView && leaf.view.file?.path === path)) return;
		let restored = false;
		await this.app.vault.process(file, (data) => { if (data !== entry.guarded) return data; restored = true; return entry.clean; });
		if (restored) this.lost.delete(path);
	}
	async toggleGuard(): Promise<void> {
		this.settings.enabled = !this.settings.enabled;
		this.guard.refresh();
		await this.saveSettings();
		new Notice(this.settings.enabled ? 'Inline math guard is on.' : 'Inline math guard is off.');
	}
	async showEquations(): Promise<boolean> {
		if (!isPro()) { proNotice(`The equation panel needs ${PRO_LABEL}.`); return false; }
		const leaf = this.app.workspace.getLeavesOfType(PANEL_ID)[0] ?? this.app.workspace.getRightLeaf(false);
		if (!leaf) return false;
		this.capturePanelNote();
		await leaf.setViewState({ type: PANEL_ID, active: false });
		await this.app.workspace.revealLeaf(leaf);
		this.renderPanels();
		return true;
	}
	capturePanelNote(): string {
		const note = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (note?.file && note.getMode() === 'source') this.panelPath = note.file.path;
		return this.panelPath;
	}
	renderPanels(): void { this.capturePanelNote(); for (const panel of this.panels) panel.render(); }
	async loadSettings(): Promise<void> { this.settings = normalizeSettings((await this.loadData()) as Partial<SteadyInlineMathSettings> | null); }
	async saveSettings(): Promise<void> { await this.saveData(this.settings); }
}
