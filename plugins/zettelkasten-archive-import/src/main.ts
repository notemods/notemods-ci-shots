import { Plugin } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { TEXT } from './copy';
import { readArchive } from './archive';
import { prepareImport, writeImport, type CancelToken, type ImportPlan, type ImportResult } from './importer';
import { ImportModal } from './modal';
import { compareArchives, DEFAULT_RULES, validateRules, type Comparison, type Rules } from './model';
import type { Archive } from './parser';
import { SPONSORS, bindPro, isPro, resetPro, proText, proNotice } from './pro';
import { Zkn3ArchiveImportSettingTab, normalizeSettings, type Zkn3ArchiveImportSettings } from './settings';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

export default class Zkn3ArchiveImportPlugin extends Plugin {
	settings: Zkn3ArchiveImportSettings = normalizeSettings(null);
	pro: SponsorsManager | null = null;
	private tab: Zkn3ArchiveImportSettingTab | null = null;
	private modals = new Set<ImportModal>();
	private importing = false;

	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		this.tab = new Zkn3ArchiveImportSettingTab(this.app, this);
		this.addSettingTab(this.tab);
		this.register(pro.onChange(() => { this.tab?.update(); for (const modal of this.modals) modal.updatePro(); }));
		this.addCommand({ id: 'import-archive', name: TEXT.title, callback: () => { this.openImport(); } });
		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
		});
	}
	onunload(): void {
		this.closeImportWindows();
		resetPro();
	}
	closeImportWindows(): void {
		for (const modal of this.modals) modal.close();
		this.modals.clear();
	}
	openImport(archive?: Archive): ImportModal {
		this.closeImportWindows();
		const modal = new ImportModal(this, archive);
		this.modals.add(modal);
		modal.open();
		return modal;
	}
	closed(modal: ImportModal): void { this.modals.delete(modal); }
	readArchive(bytes: Uint8Array): Archive { return readArchive(bytes); }
	/** Free imports use the default rules. Saved rules apply only while Pro is on. */
	activeRules(): Rules { return isPro() ? { ...this.settings.rules } : { ...DEFAULT_RULES }; }
	async prepare(archive: Archive, folder: string, rules: Rules = this.activeRules()): Promise<ImportPlan> {
		if (!isPro() && JSON.stringify(rules) !== JSON.stringify(DEFAULT_RULES)) throw new Error(proText(TEXT.needRules));
		return prepareImport(this.app.vault, archive, folder, rules);
	}
	async importPlan(plan: ImportPlan, token?: CancelToken, progress?: (done: number, total: number) => void): Promise<ImportResult> {
		if (!isPro() && JSON.stringify(plan.rules) !== JSON.stringify(DEFAULT_RULES)) throw new Error(proText(TEXT.needRules));
		if (this.importing) throw new Error('An import is in progress.');
		this.importing = true;
		try { return await writeImport(this.app.vault, plan, token, progress); } finally { this.importing = false; }
	}
	compare(earlier: Archive, later: Archive): Comparison {
		if (!isPro()) throw new Error(proText(TEXT.needCompare));
		return compareArchives(earlier, later);
	}
	async saveRules(rules: Rules): Promise<boolean> {
		if (!isPro()) { proNotice(TEXT.needRules); return false; }
		validateRules(rules);
		this.settings.rules = { ...rules };
		await this.saveSettings();
		return true;
	}
	async loadSettings(): Promise<void> { this.settings = normalizeSettings(await this.loadData()); }
	async saveSettings(): Promise<void> { await this.saveData(this.settings); }
}
