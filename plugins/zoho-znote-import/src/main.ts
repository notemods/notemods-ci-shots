import { UI } from './copy';
import { Plugin, TFile, normalizePath } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { SPONSORS, bindPro, isPro, proNotice, resetPro } from './pro';
import { DEFAULT_SETTINGS, ZohoZnoteImportSettingTab, normalizeSettings, type ZohoZnoteImportSettings } from './settings';
import { planImport, readExport, safeFolder, type Profile, validateProfile } from './importer';
import { ImportModal } from './modal';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

export interface CardIndex { version: 1; cards: Record<string, { digest: string; path: string }> }
export function parseIndex(text: string): CardIndex {
	const index = JSON.parse(text) as CardIndex;
	if (index.version !== 1 || !index.cards || typeof index.cards !== 'object' || Array.isArray(index.cards)) throw new Error('Invalid card index.');
	for (const entry of Object.values(index.cards)) if (!entry || typeof entry.path !== 'string' || !/^[a-f0-9]{64}$/.test(entry.digest)) throw new Error('Invalid card index entry.');
	return { version: 1, cards: Object.assign(Object.create(null) as CardIndex['cards'], index.cards) };
}
export default class ZohoZnoteImportPlugin extends Plugin {
	settings: ZohoZnoteImportSettings = { ...DEFAULT_SETTINGS };
	pro: SponsorsManager | null = null;
	private busy = false;
	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init(); this.pro = pro; bindPro(pro);
		const tab = new ZohoZnoteImportSettingTab(this.app, this);
		this.addSettingTab(tab); this.register(pro.onChange(() => tab.update()));
		this.addCommand({ id: 'import', name: UI.importCommand, callback: () => this.openImport() });
		this.addCommand({ id: 'compare', name: UI.compareCommand, callback: () => {
			if (!isPro()) { proNotice(UI.needsPro); return; }
			this.openImport(true);
		} });
		this.app.workspace.onLayoutReady(() => {
			void pro.refresh(); this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
		});
	}
	onunload(): void { resetPro(); }
	openImport(review = false): ImportModal { const modal = new ImportModal(this, review); this.register(() => modal.close()); modal.open(); return modal; }
	async loadSettings(): Promise<void> { this.settings = normalizeSettings(await this.loadData() as Partial<ZohoZnoteImportSettings> | null); }
	async saveSettings(): Promise<void> { await this.saveData(this.settings); }
	async saveProfile(profile: Profile): Promise<void> {
		if (!isPro()) throw new Error('Saved profiles need Pro.');
		// Validate mappings through the same planner used for import.
		if (!profile.name.trim()) throw new Error('Enter a profile name.');
		validateProfile(profile);
		this.settings.profiles = [...this.settings.profiles.filter(p => p.name !== profile.name), structuredClone(profile)];
		await this.saveSettings();
	}
	async importBytes(bytes: Uint8Array, folderInput: string, profile: Profile | null = null, baselineFolder?: string): Promise<{ notes: number; assets: number; warnings: string[]; report: string }> {
		if (this.busy) throw new Error('An import is in progress.');
		this.busy = true;
		try {
			const folder = safeFolder(folderInput);
			if (this.app.vault.getAbstractFileByPath(folder)) throw new Error('Output folder exists. Use a new folder.');
			if ((profile || baselineFolder !== undefined) && !isPro()) throw new Error('Profiles and card comparison need Pro.');
			let baseline: CardIndex | null = null;
			if (baselineFolder !== undefined) {
				const file = this.app.vault.getAbstractFileByPath(`${safeFolder(baselineFolder)}/Card index.json`);
				if (!(file instanceof TFile)) throw new Error('Baseline card index is absent.');
				baseline = parseIndex(await this.app.vault.read(file));
			}
			const archive = readExport(bytes);
			const index: CardIndex = { version: 1, cards: Object.create(null) as CardIndex['cards'] };
			const changes: string[] = [];
			const selected = [];
			for (const card of archive.cards) {
				const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(card.source).buffer);
				const digest = [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('');
				index.cards[card.id] = { digest, path: '' };
				if (!baseline || baseline.cards[card.id]?.digest !== digest) {
					selected.push(card); changes.push(`${baseline?.cards[card.id] ? 'Changed' : 'New'} card ${card.id}: ${card.title}`);
				} else changes.push(`Unchanged card ${card.id}: ${card.title}`);
			}
			if (baseline) for (const id of Object.keys(baseline.cards)) if (!index.cards[id]) changes.push(`Absent from readable cards in this export: ${id}`);
			// Links to unchanged cards remain source references in a review folder.
			const plan = planImport({ ...archive, cards: selected }, folder, profile);
			for (const note of plan.notes) index.cards[note.id]!.path = note.path;
			for (const [id, entry] of Object.entries(index.cards)) if (!entry.path) entry.path = baseline?.cards[id]?.path ?? '';
			const created = new Set<string>();
			const ensure = async (path: string): Promise<void> => {
				const parts = normalizePath(path).split('/');
				for (let i = 1; i <= parts.length; i++) {
					const parent = parts.slice(0, i).join('/');
					if (!created.has(parent) && !this.app.vault.getAbstractFileByPath(parent)) await this.app.vault.createFolder(parent);
					created.add(parent);
				}
			};
			await ensure(folder);
			const report = `${folder}/Import report.md`;
			const escaped = (s: string) => s.replace(/[\r\n]/g, ' ').replace(/[[\]<>]/g, '');
			const reportText = `# Zoho import report\n\nCards read: ${archive.cardCount}\n\nNotebooks read: ${archive.notebookCount}\n\nResource members found: ${archive.resourceCount}\n\nNotes planned: ${plan.notes.length}\n\nAssets planned: ${plan.assets.length}\n\n## Card review\n\n${changes.map(s => `- ${escaped(s)}`).join('\n') || 'No supported cards.'}\n\n## Warnings\n\n${plan.warnings.map(s => `- ${escaped(s)}`).join('\n') || 'No warnings.'}\n\nThis report lists the plan. A file write error can leave a partial import. Check the completion message.\n`;
			await this.app.vault.create(report, reportText);
			for (const asset of plan.assets) {
				await ensure(asset.path.slice(0, asset.path.lastIndexOf('/')));
				await this.app.vault.createBinary(asset.path, new Uint8Array(asset.data).buffer);
			}
			for (const note of plan.notes) {
				await ensure(note.path.slice(0, note.path.lastIndexOf('/')));
				await this.app.vault.create(note.path, note.content, note.dates);
			}
			await this.app.vault.create(`${folder}/Card index.json`, JSON.stringify(index, null, 2));
			return { notes: plan.notes.length, assets: plan.assets.length, warnings: plan.warnings, report };
		} finally { this.busy = false; }
	}
}
