import { COPY } from './copy';
import { Notice, Plugin, normalizePath, stringifyYaml, type Modal } from 'obsidian';
import { createGitHubSponsors } from './license/github-obsidian';
import type { SponsorsManager } from './license/index';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { ColornoteBackupImportSettingTab, normalizeSettings, type ColornoteBackupImportSettings } from './settings';
import { ImportModal, CompareModal } from './ui';
import { checklist, recordClass, safeName, validFolder, colorMap, type Backup, type Profile } from './backup';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

export default class ColornoteBackupImportPlugin extends Plugin {
	settings: ColornoteBackupImportSettings = { profiles: [] };
	pro: SponsorsManager | null = null;
	private importing = false;
	readonly modals = new Set<Modal>();
	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		this.settings = normalizeSettings(await this.loadData() as unknown);
		this.pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		this.pro.init();
		bindPro(this.pro);
		const tab = new ColornoteBackupImportSettingTab(this.app, this);
		this.addSettingTab(tab);
		this.register(this.pro.onChange(() => tab.update()));
		this.addCommand({ id: 'import-backup', name: COPY.importBackup, callback: () => this.openImport() });
		this.addCommand({ id: 'compare-backups', name: COPY.compareCommand, callback: () => { if (this.requirePro()) new CompareModal(this).open(); } });
		this.app.workspace.onLayoutReady(() => {
			void this.pro?.refresh();
			this.registerInterval(window.setInterval(() => void this.pro?.refresh(), 6 * 60 * 60 * 1000));
		});
	}
	onunload(): void { for (const modal of [...this.modals]) modal.close(); resetPro(); }
	openImport(): void { new ImportModal(this).open(); }
	requirePro(): boolean {
		if (isPro()) return true;
		new Notice('This is a pro feature. Sponsor on GitHub, then sign in from the plugin settings.');
		return false;
	}
	async saveProfile(profile: Profile): Promise<boolean> {
		if (!this.requirePro()) return false;
		const p = { name: profile.name.trim().slice(0, 80), folder: validFolder(profile.folder), colors: colorMap(JSON.stringify(profile.colors)) };
		if (!p.name) throw new Error('Enter a profile name.');
		const profiles = this.settings.profiles.filter((v) => v.name !== p.name);
		if (profiles.length >= 20) throw new Error('The limit is 20 saved profiles. Use an existing name to replace a profile.');
		this.settings = { profiles: [...profiles, p] };
		await this.saveData(this.settings);
		return true;
	}
	/** Prepare the complete write plan before creating the destination folder. */
	async importBackup(backup: Backup, folder = 'ColorNote imports', colors: Record<string, string> = {}): Promise<string> {
		if (this.importing) throw new Error('An import is in progress. Wait for it to finish.');
		this.importing = true;
		let written = 0;
		try {
			const parent = validFolder(folder);
			const base = normalizePath(`${parent}/Import ${new Date().toISOString().replace(/[:.]/g, '-')}`);
			let root = base;
			for (let n = 2; this.app.vault.getAbstractFileByPath(root); n++) root = `${base} ${n}`;
			const plan: { path: string; body: string; ctime: number; mtime: number }[] = [];
			const used = new Set<string>(['import report']);
			const counts = { normal: 0, system: 0, locked: 0, archive: 0, trash: 0, unsupported: 0 };
			const omitted: string[] = [];
			for (const [index, r] of backup.records.entries()) {
				const kind = recordClass(r);
				counts[kind]++;
				if (kind !== 'normal') { omitted.push(`- ${kind}: source ID ${safeName(String(r._id ?? index + 1))}; UUID ${safeName(String(r.uuid ?? 'missing'))}`); continue; }
				let name = `${safeName(r.title!)} ${safeName(r.uuid!)}`;
				const original = name;
				for (let n = 2; used.has(name.toLowerCase()); n++) name = `${original} ${n}`;
				used.add(name.toLowerCase());
				const metadata: Record<string, unknown> = { source: 'ColorNote', source_uuid: r.uuid, source_id: r._id ?? index + 1, title: r.title, created: new Date(r.created_date!).toISOString(), modified: new Date(r.modified_date!).toISOString(), color_index: r.color_index };
				if (isPro() && Object.prototype.hasOwnProperty.call(colors, String(r.color_index))) metadata.color_label = colors[String(r.color_index)];
				plan.push({ path: `${root}/${name}.md`, body: `---\n${stringifyYaml(metadata)}---\n\n${checklist(r.note!)}\n`, ctime: r.created_date!, mtime: r.modified_date! });
			}
			const report = `# ColorNote import report\n\nVersion: 7.1\n\nHeader count: ${backup.headerCount}\n\nDecoded records: ${backup.records.length}\n\n${Object.entries(counts).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n\n## Omitted records\n\n${omitted.join('\n') || 'No omitted records.'}\n\nThe header count does not limit the record stream. The password and omitted note bodies are not in this report.\n`;
			const segments = root.split('/');
			for (let n = 1; n <= segments.length; n++) {
				const path = segments.slice(0, n).join('/');
				if (!this.app.vault.getAbstractFileByPath(path)) await this.app.vault.createFolder(path);
			}
			for (const row of plan) { await this.app.vault.create(row.path, row.body, { ctime: row.ctime, mtime: row.mtime }); written++; }
			await this.app.vault.create(`${root}/Import report.md`, report);
			return root;
		} catch (e) { throw new Error(`${e instanceof Error ? e.message : String(e)} Notes written: ${written}.`); }
		finally { this.importing = false; }
	}
}
