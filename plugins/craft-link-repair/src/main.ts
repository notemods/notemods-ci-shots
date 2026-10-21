import { Notice, Plugin, TFile, TFolder, normalizePath } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { DEFAULT_SETTINGS, CraftLinkRepairSettingTab, normalizeSettings, type CraftLinkRepairSettings } from './settings';
import { inside, planRepair, reportText, safePath, type RepairPlan, type SourceFile } from './repair';
import { RepairModal } from './ui';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

export interface WriteResult { written: string[]; failures: string[]; report: string }
export default class CraftLinkRepairPlugin extends Plugin {
	settings: CraftLinkRepairSettings = { ...DEFAULT_SETTINGS };
	pro: SponsorsManager | null = null;
	receipts: Record<string, string> = {};
	private busy = false;
	private autoTimer: number | null = null;
	private alive = false;
	private saveQueue = Promise.resolve();
	lastResult: WriteResult | null = null;

	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		this.alive = true;
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init(); this.pro = pro; bindPro(pro);
		const tab = new CraftLinkRepairSettingTab(this.app, this);
		this.addSettingTab(tab);
		this.register(pro.onChange(() => tab.update()));
		this.addCommand({ id: 'preview-repair', name: 'Preview repaired copies', callback: () => { this.openPreview(); } });
		this.app.workspace.onLayoutReady(() => {
			if (!this.alive) return;
			void pro.refresh();
			this.registerInterval(window.setInterval(() => { void pro.refresh(); }, 6 * 60 * 60 * 1000));
			const onSource = (file: import('obsidian').TAbstractFile) => { if (file instanceof TFile) this.scheduleAutomatic(file.path); };
			this.registerEvent(this.app.vault.on('create', onSource));
			this.registerEvent(this.app.vault.on('modify', onSource));
		});
	}
	onunload(): void {
		this.alive = false;
		if (this.autoTimer !== null) window.clearTimeout(this.autoTimer);
		resetPro();
	}
	openPreview(): RepairModal { const modal = new RepairModal(this); modal.open(); this.register(() => modal.close()); return modal; }
	async loadSettings(): Promise<void> {
		const data = await this.loadData() as unknown;
		this.settings = normalizeSettings(data);
		if (data && typeof data === 'object' && 'receipts' in data && data.receipts && typeof data.receipts === 'object') {
			this.receipts = {};
			for (const [source, path] of Object.entries(data.receipts)) {
				if (typeof path === 'string' && source !== path && source.length < 2000 && path.length < 2000) this.receipts[source] = path;
			}
		}
	}
	async saveSettings(): Promise<void> {
		const data = { ...this.settings, receipts: { ...this.receipts } };
		this.saveQueue = this.saveQueue.catch(() => undefined).then(async () => { await this.saveData(data); });
		await this.saveQueue;
	}
	async prepare(folder: string): Promise<RepairPlan> {
		const path = safePath(folder);
		const root = this.app.vault.getAbstractFileByPath(path);
		if (!(root instanceof TFolder)) throw new Error('Select an existing export folder in this vault.');
		const files = this.app.vault.getFiles();
		const selected = files.filter((f) => inside(f.path, path) && (/\.md$/i.test(f.path) || /\/info\.json$/i.test(f.path)) && !/\.repaired\.md$/i.test(f.path) && !/\/Craft repair report(?: \d+)?\.md$/i.test(f.path));
		const sources: SourceFile[] = [];
		for (const file of selected) sources.push({ path: file.path, text: await this.app.vault.read(file) });
		const options = { ...this.settings, folder: path, pro: isPro(), occupied: files.map((f) => f.path), receipts: this.receipts };
		const first = planRepair(sources, options);
		for (const copy of first.copies) {
			if (this.app.vault.getAbstractFileByPath(copy.path) && !options.occupied.includes(copy.path)) options.occupied.push(copy.path);
		}
		const plan = planRepair(sources, options);
		for (const copy of plan.copies) {
			const parts = copy.path.split('/'); parts.pop();
			let folderPath = '';
			for (const part of parts) {
				folderPath = normalizePath(folderPath ? `${folderPath}/${part}` : part);
				const existing = this.app.vault.getAbstractFileByPath(folderPath);
				if (existing && !(existing instanceof TFolder)) plan.blocked.push(`A file blocks the output folder: ${folderPath}`);
			}
		}
		return plan;
	}
	private async ensureParent(path: string): Promise<void> {
		const parts = path.split('/'); parts.pop();
		let current = '';
		for (const part of parts) {
			current = normalizePath(current ? `${current}/${part}` : part);
			const existing = this.app.vault.getAbstractFileByPath(current);
			if (existing && !(existing instanceof TFolder)) throw new Error(`A file blocks the output folder: ${current}`);
			if (!existing) await this.app.vault.createFolder(current);
		}
	}
	/** Rebuild and compare the plan before writes, including the current Pro state. */
	async writePlan(reviewed: RepairPlan): Promise<WriteResult> {
		if (this.busy) throw new Error('A repair pass is in progress.');
		this.busy = true;
		try {
			const current = await this.prepare(reviewed.folder);
			if (JSON.stringify(current) !== JSON.stringify(reviewed)) throw new Error('Source files, output paths, or Pro status changed. Preview again.');
			if (current.blocked.length) throw new Error(current.blocked.join('\n'));
			const result: WriteResult = { written: [], failures: [], report: '' };
			for (const copy of current.copies) {
				try {
					await this.ensureParent(copy.path);
					await this.app.vault.create(normalizePath(copy.path), copy.text);
					this.receipts[copy.source] = copy.path;
					result.written.push(copy.path);
				} catch (error) { result.failures.push(`Stopped at ${copy.path}: ${error instanceof Error ? error.message : String(error)}`); break; }
			}
			try { await this.saveSettings(); } catch (error) { result.failures.push(`Could not save copy records: ${error instanceof Error ? error.message : String(error)}`); }
			let report = normalizePath(`${current.folder}/Craft repair report.md`), index = 2;
			while (this.app.vault.getAbstractFileByPath(report)) { report = normalizePath(`${current.folder}/Craft repair report ${index}.md`); index++; }
			try { await this.app.vault.create(report, reportText(current, result.written, result.failures)); result.report = report; }
			catch (error) { result.failures.push(`Could not write the report: ${error instanceof Error ? error.message : String(error)}`); }
			this.lastResult = result;
			new Notice(`Craft repair: ${result.written.length} copies. ${result.failures.length} write failures. ${current.issues.length} review items.`);
			return result;
		} finally { this.busy = false; }
	}
	scheduleAutomatic(path: string): void {
		let folder = '';
		try { folder = safePath(this.settings.folder); } catch { return; }
		if (!this.alive || !isPro() || !this.settings.automatic || !inside(path, folder) || (!/\.md$/i.test(path) && !/\/info\.json$/i.test(path)) || /\.repaired\.md$/i.test(path) || /\/Craft repair report(?: \d+)?\.md$/i.test(path)) return;
		if (this.autoTimer !== null) window.clearTimeout(this.autoTimer);
		this.autoTimer = window.setTimeout(() => { this.autoTimer = null; void this.runAutomatic(); }, 1500);
	}
	async runAutomatic(): Promise<WriteResult | null> {
		if (!this.alive || !isPro() || !this.settings.automatic || this.busy) return null;
		try {
			const plan = await this.prepare(this.settings.folder);
			if (!isPro() || !this.settings.automatic || !this.alive || !plan.copies.length || plan.blocked.length) return null;
			// A new bundle can arrive in parts. Wait for a valid id before copying its Markdown.
			if (plan.issues.some((i) => i.source.endsWith('/info.json')) || plan.copies.some((c) => !this.app.vault.getAbstractFileByPath(normalizePath(`${c.source.slice(0, c.source.lastIndexOf('/'))}/info.json`)))) return null;
			return await this.writePlan(plan);
		} catch (error) { new Notice(`Automatic Craft repair stopped: ${error instanceof Error ? error.message : String(error)}`); return null; }
	}
}
