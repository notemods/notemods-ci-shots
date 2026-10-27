import { Notice, Plugin, TFile, TFolder, getFrontMatterInfo, normalizePath, parseYaml } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { DEFAULT_OPTIONS, buildPlan, chapterSources, outputFolder, type ExportOptions, type ExportPlan } from './core';
import { DEFAULT_SETTINGS, ChapterBatchExportSettingTab, normalizeSettings, type ChapterBatchExportSettings } from './settings';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { ExportModal } from './modal';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';
export interface Preview { indexPath: string; options: ExportOptions; plan: ExportPlan; pro: boolean }
export default class ChapterBatchExportPlugin extends Plugin {
	settings: ChapterBatchExportSettings = { ...DEFAULT_SETTINGS, presets: [] };
	pro: SponsorsManager | null = null;
	private busy = false;
	readonly modals = new Set<ExportModal>();
	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this); pro.init(); this.pro = pro; bindPro(pro);
		const tab = new ChapterBatchExportSettingTab(this.app, this); this.addSettingTab(tab);
		this.register(pro.onChange(() => tab.update()));
		this.addCommand({ id: 'preview-chapters', name: 'Preview chapter export', checkCallback: (checking) => {
			const file = this.app.workspace.getActiveFile();
			if (!file || file.extension !== 'md') return false;
			if (!checking) this.openExport(file);
			return true;
		} });
		this.app.workspace.onLayoutReady(() => { void pro.refresh(); this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000)); });
	}
	onunload(): void { for (const modal of [...this.modals]) modal.close(); resetPro(); }
	openExport(file: TFile): ExportModal { const modal = new ExportModal(this, file); this.modals.add(modal); modal.open(); return modal; }
	async loadSettings(): Promise<void> { this.settings = normalizeSettings((await this.loadData()) as Partial<ChapterBatchExportSettings> | null); }
	async saveSettings(): Promise<void> { await this.saveData(this.settings); }
	async savePreset(name: string, options: ExportOptions): Promise<void> {
		if (!isPro()) throw new Error('Named export presets need Pro.');
		if (!name.trim() || name.length > 80) throw new Error('Use a preset name with 1 to 80 characters.');
		const preset = { ...options, name: name.trim() };
		this.settings.presets = [...this.settings.presets.filter((p) => p.name !== preset.name), preset].slice(-50);
		await this.saveSettings();
	}
	async prepare(indexPath: string, options: ExportOptions = { ...DEFAULT_OPTIONS, folder: this.settings.outputFolder }): Promise<Preview> {
		const file = this.app.vault.getAbstractFileByPath(normalizePath(indexPath));
		if (!(file instanceof TFile)) throw new Error('The index file is missing.');
		const text = await this.app.vault.read(file); const info = getFrontMatterInfo(text);
		if (!info.exists) throw new Error('The index needs initial Longform frontmatter.');
		const fm: unknown = parseYaml(info.frontmatter);
		const opts = isPro() ? { ...options } : { ...DEFAULT_OPTIONS, folder: options.folder };
		const skeleton = buildPlan(fm, file.path, {}, opts, isPro());
		const selectedPaths = new Set(skeleton.chapters.flatMap((c) => c.sources));
		const sources: Record<string, string> = Object.create(null) as Record<string, string>;
		// Validate the whole tree before the first source read.
		chapterSources(fm, file.path);
		for (const path of selectedPaths) {
			const source = this.app.vault.getAbstractFileByPath(normalizePath(path));
			if (source instanceof TFile) sources[path] = await this.app.vault.read(source);
		}
		return { indexPath: file.path, options: opts, plan: buildPlan(fm, file.path, sources, opts, isPro()), pro: isPro() };
	}
	async exportPreview(preview: Preview): Promise<string> {
		if (this.busy) throw new Error('An export is in progress.');
		const folder = normalizePath(outputFolder(preview.options.folder));
		this.busy = true; let started = false;
		try {
			const fresh = await this.prepare(preview.indexPath, preview.options);
			if (JSON.stringify(fresh) !== JSON.stringify(preview)) throw new Error('The source or Pro state changed. Make a new preview.');
			if (fresh.plan.missing.length) throw new Error('Export stopped. Fix the missing scene paths first.');
			if (this.app.vault.getAbstractFileByPath(folder)) throw new Error('The output folder exists. Use a new folder.');
			const parent = folder.split('/').slice(0, -1).join('/');
			if (parent && !(this.app.vault.getAbstractFileByPath(parent) instanceof TFolder)) throw new Error('The parent output folder does not exist.');
			await this.app.vault.createFolder(folder); started = true;
			for (const chapter of fresh.plan.chapters) await this.app.vault.create(normalizePath(`${folder}/${chapter.filename}`), chapter.content);
			await this.app.vault.create(normalizePath(`${folder}/_index.md`), fresh.plan.index);
			new Notice(`Saved ${fresh.plan.chapters.length} ${fresh.plan.chapters.length === 1 ? 'chapter' : 'chapters'} in ${folder}.`); return folder;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(started ? `Export is incomplete in ${folder}. ${message} Use a new folder to retry.` : message);
		} finally { this.busy = false; }
	}
}
