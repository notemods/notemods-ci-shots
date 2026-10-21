import { Notice, Plugin, TFolder, normalizePath, type TFile } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { availablePath, renderCards, validateOutputPath, validateTemplate, type Card, type CardTemplate } from './cards';
import { parseSubtitles } from './cues';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { DEFAULT_SETTINGS, SubtitleSentenceMinerSettingTab, normalizeSettings, type SubtitleSentenceMinerSettings } from './settings';
import { MinerModal, SourcePicker } from './ui';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

export function showError(error: unknown): void {
	new Notice(error instanceof Error ? error.message : String(error));
}

export default class SubtitleSentenceMinerPlugin extends Plugin {
	settings: SubtitleSentenceMinerSettings = { ...DEFAULT_SETTINGS, templates: [] };
	pro: SponsorsManager | null = null;
	readonly miners = new Set<MinerModal>();
	private stopped = false;

	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		this.stopped = false;
		await this.loadSettings();
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		const tab = new SubtitleSentenceMinerSettingTab(this.app, this);
		this.addSettingTab(tab);
		this.register(pro.onChange(() => tab.update()));
		this.addCommand({ id: 'mine-subtitles', name: 'Select a subtitle file', callback: () => new SourcePicker(this, (file) => this.openSource(file)).open() });
		this.addCommand({
			id: 'mine-active-subtitle', name: 'Mine the active subtitle file',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || !this.isSubtitle(file)) return false;
				if (!checking) void this.openSource(file);
				return true;
			},
		});
		this.app.workspace.onLayoutReady(() => {
			if (this.stopped) return;
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
		});
	}

	onunload(): void {
		this.stopped = true;
		for (const miner of [...this.miners]) miner.close();
		resetPro();
	}

	isSubtitle(file: TFile): boolean { return /^(srt|vtt)$/i.test(file.extension); }

	async openSource(file: TFile): Promise<MinerModal | null> {
		try {
			if (!this.isSubtitle(file)) throw new Error('Select an SRT or VTT file in this vault.');
			const parsed = parseSubtitles(await this.app.vault.read(file));
			if (this.stopped) return null;
			const modal = new MinerModal(this, file.path, parsed);
			modal.open();
			return modal;
		} catch (error) { showError(error); return null; }
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData() as unknown);
	}

	async saveSettings(): Promise<void> { await this.saveData(this.settings); }

	async saveTemplate(template: CardTemplate): Promise<void> {
		if (!isPro()) throw new Error('Saved templates need Pro. Sponsor on GitHub, then sign in from settings.');
		validateTemplate(template.body);
		const name = template.name.trim();
		if (!name || name.length > 80) throw new Error('Use a template name with 1 to 80 characters.');
		const templates = this.settings.templates.filter((item) => item.name !== name);
		if (templates.length >= 30) throw new Error('Remove a saved template before you add another. The limit is 30.');
		const updated = { ...this.settings, templates: [...templates, { name, body: template.body }] };
		await this.saveData(updated);
		this.settings = updated;
	}

	planPath(requested: string): string {
		validateOutputPath(requested, this.app.vault.configDir);
		const path = normalizePath(requested);
		validateOutputPath(path, this.app.vault.configDir);
		return availablePath(path, (candidate) => this.app.vault.getAbstractFileByPath(candidate) !== null);
	}

	checkCards(cards: Card[], template?: string): void {
		if (new Set(cards.map((card) => card.source)).size > 1 && !isPro()) throw new Error('Combined cards from several files need Pro.');
		if (template !== undefined && !isPro()) throw new Error('Saved templates need Pro.');
	}

	/** The preview calls this method only after the user selects Create note. */
	async createCards(path: string, cards: Card[], template?: string): Promise<TFile> {
		this.checkCards(cards, template);
		validateOutputPath(path, this.app.vault.configDir);
		const text = renderCards(cards, template);
		if (this.app.vault.getAbstractFileByPath(path)) throw new Error('The output path is now in use. Review a new path.');
		const parts = path.split('/');
		for (let n = 1; n < parts.length; n++) {
			const folder = parts.slice(0, n).join('/');
			const existing = this.app.vault.getAbstractFileByPath(folder);
			if (existing && !(existing instanceof TFolder)) throw new Error(`A file blocks the output folder: ${folder}`);
			if (!existing) await this.app.vault.createFolder(folder);
		}
		return this.app.vault.create(path, text);
	}
}
