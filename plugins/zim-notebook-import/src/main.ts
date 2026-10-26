import { Notice, Plugin, TFolder, normalizePath, stringifyYaml } from 'obsidian';
import { compareZimSources, planZimImport, validZimPath, ZIM_RULES, type ZimPlan, type ZimRules, type ZimSource } from './core/index';
import { createGitHubSponsors } from './license/github-obsidian';
import type { SponsorsManager } from './license/index';
import { SPONSORS, bindPro, isPro, resetPro, proNotice } from './pro';
import { DEFAULT_SETTINGS, normalizeSettings, ZimNotebookImportSettingTab, type ZimNotebookImportSettings } from './settings';
import { ImportModal } from './ui';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';
export interface PreparedImport { source: string; destination: string; rules: ZimRules; sources: ZimSource[]; plan: ZimPlan }
export default class ZimNotebookImportPlugin extends Plugin {
	settings: ZimNotebookImportSettings = { ...DEFAULT_SETTINGS };
	pro: SponsorsManager | null = null;
	private busy = false;
	private stopped = false;
	private modals = new Set<ImportModal>();
	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		this.stopped = false;
		await this.loadSettings();
		if (this.stopped) return;
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init(); this.pro = pro; bindPro(pro);
		const tab = new ZimNotebookImportSettingTab(this.app, this);
		this.addSettingTab(tab); this.register(pro.onChange(() => tab.update()));
		this.addCommand({ id: 'import', name: 'Zim page import', callback: () => { this.openImport(); } });
		this.addCommand({ id: 'preview-later-import', name: 'Preview source changes for a later import', callback: () => { void this.openLaterPreview(); } });
		this.app.workspace.onLayoutReady(() => {
			if (this.stopped) return;
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
		});
	}
	onunload(): void {
		this.stopped = true;
		for (const modal of this.modals) modal.close();
		this.modals.clear();
		resetPro();
	}
	async loadSettings(): Promise<void> { this.settings = normalizeSettings(await this.loadData()); }
	async saveSettings(): Promise<void> { await this.saveData(this.settings); }
	openImport(): ImportModal {
		const modal = new ImportModal(this, () => this.modals.delete(modal));
		this.modals.add(modal); modal.open(); return modal;
	}
	async readSource(source: string): Promise<ZimSource[]> {
		const folder = this.app.vault.getAbstractFileByPath(source);
		if (!(folder instanceof TFolder)) throw new Error('Select an existing source folder in this vault.');
		const sources: ZimSource[] = [];
		for (const f of this.app.vault.getFiles().filter((f) => f.path.startsWith(source + '/')).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
			sources.push({ path: f.path, text: f.extension.toLowerCase() === 'txt' ? await this.app.vault.read(f) : '' });
		}
		return sources;
	}
	async prepare(sourceInput: string, destinationInput: string, rules: ZimRules = ZIM_RULES): Promise<PreparedImport> {
		if (!validZimPath(sourceInput.trim()) || !validZimPath(destinationInput.trim())) throw new Error('Use valid vault folder paths. Do not use a dot or a parent path segment.');
		const source = normalizePath(sourceInput.trim()); const destination = normalizePath(destinationInput.trim());
		const sources = await this.readSource(source);
		const existing = this.app.vault.getAllLoadedFiles().map((f) => f.path);
		const plan = planZimImport(sources, source, destination, existing, rules);
		const parentParts = destination.split('/');
		for (let n = 1; n < parentParts.length; n++) {
			const parent = parentParts.slice(0, n).join('/');
			const found = this.app.vault.getAllLoadedFiles().find((f) => f.path.normalize('NFC').toLowerCase() === parent.normalize('NFC').toLowerCase());
			if (found && !(found instanceof TFolder)) plan.conflicts.push(`A file blocks the destination folder: ${found.path}`);
			else if (found && found.path !== parent) plan.conflicts.push(`Use the existing folder case: ${found.path}`);
		}
		// The report lives beside the notes and must not use a planned note path.
		const reportPath = `${destination}/zim import report.md`.toLowerCase();
		if (plan.notes.some((n) => n.path.toLowerCase() === reportPath || n.path.toLowerCase().startsWith(reportPath + '/'))) plan.conflicts.push('Reserved output name: Zim import report.md');
		return { source, destination, rules: { ...rules }, sources, plan };
	}
	async saveRules(source: string, destination: string, rules: ZimRules): Promise<boolean> {
		if (!isPro()) { proNotice('Saved import rules need pro.'); return false; }
		if (!validZimPath(source) || !validZimPath(destination)) throw new Error('Use valid vault folder paths.');
		this.settings.saved = { source: normalizePath(source), destination: normalizePath(destination), rules: { ...rules } };
		await this.saveSettings(); return true;
	}
	async laterPreview(): Promise<ReturnType<typeof compareZimSources> | null> {
		if (!isPro()) { proNotice('The later import preview needs pro.'); return null; }
		const snapshot = this.settings.snapshot;
		if (!snapshot) throw new Error('Import a source folder first to store a comparison.');
		return compareZimSources(snapshot.pages, await this.readSource(snapshot.source));
	}
	async openLaterPreview(): Promise<void> {
		try {
			const changes = await this.laterPreview();
			if (changes && !this.stopped) { const modal = this.openImport(); modal.showChanges(changes); }
		} catch (error) { new Notice(String(error)); }
	}
	/** Re-read the source and repeat conflict checks immediately before the first write. */
	async writeImport(prepared: PreparedImport): Promise<{ created: number; report: string }> {
		if (this.stopped) throw new Error('The importer is disabled.');
		if (this.busy) throw new Error('An import is in progress.');
		this.busy = true;
		let created = 0;
		try {
			const fresh = await this.prepare(prepared.source, prepared.destination, prepared.rules);
			if (this.stopped) throw new Error('The importer is disabled.');
			if (JSON.stringify(fresh.sources) !== JSON.stringify(prepared.sources)) throw new Error('The source changed after the plan. Make a new plan.');
			if (fresh.plan.conflicts.length) throw new Error(fresh.plan.conflicts.join('\n'));
			const parent = fresh.destination.slice(0, fresh.destination.lastIndexOf('/'));
			if (fresh.destination.includes('/')) await this.ensureFolder(parent);
			// Reserve the new destination. A concurrent creator must not turn it into a reused folder.
			await this.app.vault.createFolder(normalizePath(fresh.destination));
			for (const note of fresh.plan.notes) {
				if (this.stopped) throw new Error('The importer is disabled.');
				await this.ensureFolder(note.path.slice(0, note.path.lastIndexOf('/')));
				await this.app.vault.create(normalizePath(note.path), `---\n${stringifyYaml(note.properties)}---\n\n${note.body}`);
				created++;
			}
			const report = normalizePath(`${fresh.destination}/Zim import report.md`);
			const lines = [`# Zim import report`, '', `Created ${created} notes from ${fresh.source}.`, '', 'Source files stay in place.', '', ...fresh.plan.issues.map((issue) => `- ${issue.kind} | ${issue.source}:${issue.line} | ${issue.detail.replace(/\n/g, ' ')}`)];
			if (!fresh.plan.issues.length) lines.push('No unsupported content or unresolved links found by the basic converter.');
			await this.app.vault.create(report, lines.join('\n'));
			this.settings.snapshot = { source: fresh.source, destination: fresh.destination, pages: fresh.sources.filter((s) => /\.txt$/i.test(s.path)) };
			await this.saveSettings();
			return { created, report };
		} catch (error) { throw new Error(`Import stopped after ${created} notes. ${String(error)} Keep this output for review and use a new destination for a retry.`); }
		finally { this.busy = false; }
	}
	private async ensureFolder(path: string): Promise<void> {
		const parts = normalizePath(path).split('/');
		for (let n = 1; n <= parts.length; n++) {
			const folder = normalizePath(parts.slice(0, n).join('/'));
			const found = this.app.vault.getAbstractFileByPath(folder);
			if (found && !(found instanceof TFolder)) throw new Error(`A file blocks the folder: ${folder}`);
			if (!found) await this.app.vault.createFolder(folder);
		}
	}
}
