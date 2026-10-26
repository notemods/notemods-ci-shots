import { Notice, Plugin, normalizePath } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { SPONSORS, bindPro, isPro, resetPro, proNotice } from './pro';
import { DEFAULT_SETTINGS, PocketNoteQuizSettingTab, normalizeSettings, type PocketNoteQuizSettings } from './settings';
import { applyMarks, clearMarks, inFolder, parseQuestions, scoreReport, type Card, type Response } from './quiz';
import { QuizModal } from './modal';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

export default class PocketNoteQuizPlugin extends Plugin {
	settings: PocketNoteQuizSettings = { ...DEFAULT_SETTINGS, presets: [] };
	pro: SponsorsManager | null = null;
	quiz: QuizModal | null = null;
	private settingTab: PocketNoteQuizSettingTab | null = null;
	private stopped = false;
	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		this.stopped = false;
		await this.loadSettings();
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init(); this.pro = pro; bindPro(pro);
		this.settingTab = new PocketNoteQuizSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		this.register(pro.onChange(() => this.settingTab?.update()));
		this.addCommand({ id: 'start-quiz', name: 'Start quiz on current note', callback: () => { void this.run(() => this.startCurrent()); } });
		this.app.workspace.onLayoutReady(() => {
			if (this.stopped) return;
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
		});
	}
	onunload(): void { this.stopped = true; this.quiz?.close(); resetPro(); }
	async loadSettings(): Promise<void> { this.settings = normalizeSettings(await this.loadData() as Partial<PocketNoteQuizSettings> | null); }
	async saveSettings(): Promise<void> { await this.saveData(this.settings); }
	async run(action: () => Promise<unknown>): Promise<void> {
		try { await action(); } catch (e) { new Notice(`Quiz action failed: ${e instanceof Error ? e.message : String(e)}`); }
	}
	needsPro(): boolean {
		if (isPro()) return false;
		proNotice('This is a pro feature.'); return true;
	}
	async startCurrent(): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (!file || file.extension !== 'md') { new Notice('Open a Markdown note to start a quiz.'); return; }
		const cards = parseQuestions(await this.app.vault.read(file), this.settings.marker, file.path);
		this.openQuiz(cards, [file.path], file.path);
	}
	openQuiz(cards: Card[], paths: string[], title: string): void {
		if (this.stopped) return;
		this.quiz?.close();
		this.quiz = new QuizModal(this, cards, paths, title, this.settings.marker);
		this.quiz.open();
	}
	async startFolder(folderInput: string): Promise<void> {
		if (this.needsPro()) return;
		const folder = normalizePath(folderInput.trim());
		if (folder && folder !== '/' && !this.app.vault.getFolderByPath(folder)) { new Notice('Folder not found.'); return; }
		const selected = this.app.vault.getMarkdownFiles().filter((f) => inFolder(f.path, folder === '/' ? '' : folder)).sort((a, b) => a.path.localeCompare(b.path));
		const cards: Card[] = [];
		for (const file of selected) cards.push(...parseQuestions(await this.app.vault.read(file), this.settings.marker, file.path));
		if (this.needsPro()) return;
		this.openQuiz(cards, selected.map((f) => f.path), folder || 'Vault root');
	}
	async apply(responses: Response[], marker: string): Promise<{ applied: number; skipped: number }> {
		let applied = 0; let skipped = 0;
		for (const path of new Set(responses.map((c) => c.path))) {
			const group = responses.filter((c) => c.path === path);
			const file = this.app.vault.getFileByPath(path);
			if (!file) { skipped += group.length; continue; }
			await this.app.vault.process(file, (text) => {
				const result = applyMarks(text, group, marker);
				applied += result.applied; skipped += result.skipped; return result.text;
			});
		}
		new Notice(`Applied ${applied} marks; ${skipped} skipped card${skipped === 1 ? '' : 's'}.`);
		return { applied, skipped };
	}
	async clear(paths: string[], marker: string): Promise<void> {
		for (const path of paths) {
			const file = this.app.vault.getFileByPath(path);
			if (file) await this.app.vault.process(file, (text) => clearMarks(text, marker));
		}
		new Notice('Cleared marks from question lines.');
	}
	async saveReport(responses: Response[]): Promise<string | null> {
		if (this.needsPro()) return null;
		const date = new Date().toISOString();
		const base = normalizePath(`Pocket Note Quiz ${date.replace(/[:.]/g, '-')}`);
		let path = base + '.md';
		for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = `${base} ${n}.md`;
		await this.app.vault.create(path, scoreReport(responses, date));
		new Notice(`Saved score report to ${path}`); return path;
	}
	async addPreset(name: string, marker: string): Promise<boolean> {
		if (this.needsPro()) return false;
		if (!name.trim() || !marker.trim()) { new Notice('Enter a preset name and a question marker.'); return false; }
		this.settings.presets = this.settings.presets.filter((p) => p.name !== name.trim());
		this.settings.presets.push({ name: name.trim(), marker }); await this.saveSettings(); return true;
	}
	async usePreset(name: string): Promise<boolean> {
		if (this.needsPro()) return false;
		const p = this.settings.presets.find((p) => p.name === name);
		if (!p) return false;
		this.settings.marker = p.marker; await this.saveSettings(); return true;
	}
}
