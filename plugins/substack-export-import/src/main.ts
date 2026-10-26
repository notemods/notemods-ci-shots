import { Notice, Plugin, TFile, TFolder, normalizePath, stringifyYaml } from 'obsidian';
import { createGitHubSponsors, proNeededText } from './license/github-obsidian';
import type { SponsorsManager } from './license/index';
import { PRO_COMPARE, PRO_PROFILES, SPONSORS, bindPro, isPro, resetPro } from './pro';
import { DEFAULT_MAPPING, compareBodies, parseSnapshot, makeReport, makeSnapshot, prepareImport, readArchive, validateFolder, validateMapping, type Change, type Mapping, type Preview } from './importer';
import { convertBody } from './convert';
import { DEFAULT_SETTINGS, normalizeSettings, SubstackExportImportSettingTab, type Profile, type SubstackExportImportSettings } from './settings';
import { ImportModal } from './modal';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

export default class SubstackExportImportPlugin extends Plugin {
	settings: SubstackExportImportSettings = { ...DEFAULT_SETTINGS, profiles: [] };
	pro: SponsorsManager | null = null;
	private writing = false;
	readonly activeImports = new Set<ImportModal>();
	private settingTab: SubstackExportImportSettingTab | null = null;
	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		this.register(() => { for (const modal of this.activeImports) modal.close(); });
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init(); this.pro = pro; bindPro(pro);
		this.settingTab = new SubstackExportImportSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		this.register(pro.onChange(() => this.settingTab?.update()));
		this.addCommand({ id: 'import-export', name: 'Import writer export', callback: () => { this.openImport(); } });
		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
		});
	}
	onunload(): void { resetPro(); }
	openImport(): ImportModal { const modal = new ImportModal(this); this.activeImports.add(modal); modal.open(); return modal; }
	async loadSettings(): Promise<void> { this.settings = normalizeSettings(await this.loadData()); }
	async saveSettings(): Promise<void> { await this.saveData(this.settings); }
	prepare(bytes: Uint8Array, mapping: Mapping = DEFAULT_MAPPING): Preview { return prepareImport(readArchive(bytes), convertBody, mapping); }
	async saveProfile(profile: Profile): Promise<void> {
		if (!isPro()) throw new Error(proNeededText(this.pro, PRO_PROFILES));
		validateFolder(profile.folder); validateMapping(profile.mapping);
		const name = profile.name.trim();
		if (!name || name.length > 80) throw new Error('Use a profile name with 1 to 80 characters.');
		const profiles = this.settings.profiles.filter((p) => p.name !== name);
		if (profiles.length >= 30) throw new Error('The limit is 30 saved profiles.');
		profiles.push({ name, folder: profile.folder, mapping: { ...profile.mapping } });
		await this.saveData({ profiles });
		this.settings = { profiles };
	}
	loadProfile(name: string): Profile {
		if (!isPro()) throw new Error(proNeededText(this.pro, PRO_PROFILES));
		const profile = this.settings.profiles.find((p) => p.name === name);
		if (!profile) throw new Error('The profile was not found.');
		return { ...profile, mapping: { ...profile.mapping } };
	}
	async compareImport(previous: string, preview: Preview): Promise<Change[]> {
		if (!isPro()) throw new Error(proNeededText(this.pro, PRO_COMPARE));
		validateFolder(previous);
		const file = this.app.vault.getAbstractFileByPath(normalizePath(`${previous}/_substack-snapshot.json`));
		if (!(file instanceof TFile)) throw new Error('The previous import snapshot was not found.');
		const snapshot = parseSnapshot(await this.app.vault.read(file));
		if (!isPro()) throw new Error(proNeededText(this.pro, PRO_COMPARE));
		return compareBodies(snapshot, preview);
	}
	checkFolder(input: string): string {
		validateFolder(input);
		const folder = normalizePath(input);
		validateFolder(folder);
		if (this.app.vault.getAbstractFileByPath(folder)) throw new Error('The output folder exists. Use a new folder.');
		const slash = folder.lastIndexOf('/');
		if (slash >= 0 && !(this.app.vault.getAbstractFileByPath(folder.slice(0, slash)) instanceof TFolder)) throw new Error('The parent folder must exist.');
		return folder;
	}
	async writeImport(preview: Preview, input: string): Promise<string> {
		if (this.writing) throw new Error('An import is in progress.');
		const folder = this.checkFolder(input);
		// Make the complete write plan before the first vault write.
		const notes = preview.posts.map((p) => ({ path: normalizePath(`${folder}/${p.id}.md`), text: `---\n${stringifyYaml(p.properties)}---\n\n${p.body}\n`, ...(p.timestamp === undefined ? {} : { options: { ctime: p.timestamp, mtime: p.timestamp } }) }));
		const report = makeReport(preview);
		const snapshot = JSON.stringify(makeSnapshot(preview), null, 2);
		this.writing = true;
		try {
			await this.app.vault.createFolder(folder);
			for (const note of notes) await this.app.vault.create(note.path, note.text, note.options);
			await this.app.vault.create(normalizePath(`${folder}/Import report.md`), report);
			await this.app.vault.create(normalizePath(`${folder}/_substack-snapshot.json`), snapshot);
			new Notice(`Created ${notes.length} notes and an import report in ${folder}.`);
			return folder;
		} finally { this.writing = false; }
	}
}
