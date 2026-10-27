import { Notice, Plugin } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { draftExtension } from './capture';
import { captureDraft, dismissDraft, normalizeLimit, normalizeSettings, retain, type Capture, type DraftSettings } from './model';
import { SaveQueue } from './persistence';
import { RecoveryModal } from './recovery';
import { KanbanDraftVaultSettingTab } from './settings';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

export default class KanbanDraftVaultPlugin extends Plugin {
	settings: DraftSettings = { drafts: [], limits: {} };
	pro: SponsorsManager | null = null;
	private readonly listeners = new Set<() => void>();
	private saveWarning = false;
	readonly saves = new SaveQueue<DraftSettings>(async (snapshot) => this.saveData(snapshot), () => {
		if (this.saves.error && !this.saveWarning) {
			this.saveWarning = true;
			new Notice('Draft save failed. Keep this app open. Open draft recovery and select the retry button.');
		}
		if (!this.saves.error) this.saveWarning = false;
		this.notify();
	});

	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		const tab = new KanbanDraftVaultSettingTab(this.app, this);
		this.addSettingTab(tab);
		this.register(pro.onChange(() => { tab.update(); this.notify(); }));
		this.registerEditorExtension(draftExtension((input) => this.capture(input)));
		this.addCommand({ id: 'recover-drafts', name: 'Open draft recovery', callback: () => new RecoveryModal(this).open() });
		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
		});
	}
	onunload(): void {
		resetPro();
		this.listeners.clear();
	}
	async loadSettings(): Promise<void> { this.settings = normalizeSettings(await this.loadData()); }
	async saveSettings(): Promise<void> {
		this.saves.request(this.settings);
		await this.saves.flush();
	}
	capture(input: Capture): void {
		const next = captureDraft(this.settings, input, isPro());
		if (next === this.settings) return;
		this.settings = next;
		this.saves.request(next);
		this.notify();
	}
	async dismiss(id: string): Promise<boolean> {
		this.settings = dismissDraft(this.settings, id);
		await this.saveSettings();
		this.notify();
		return this.saves.error === null;
	}
	async setBoardLimit(path: string, limit: unknown): Promise<boolean> {
		if (!isPro() || !path.trim()) return false;
		this.settings = retain({ ...this.settings, limits: { ...this.settings.limits, [path]: normalizeLimit(limit) } }, Date.now(), true);
		await this.saveSettings();
		this.notify();
		return this.saves.error === null;
	}
	onChange(callback: () => void): () => void {
		this.listeners.add(callback);
		return () => { this.listeners.delete(callback); };
	}
	private notify(): void { for (const listener of this.listeners) listener(); }
}
