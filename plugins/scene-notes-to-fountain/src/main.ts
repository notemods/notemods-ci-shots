import { Notice, Plugin, TFile, getFrontMatterInfo, normalizePath, parseYaml } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { DEFAULT_MAPPING, buildPlan, cleanFileName, errorText, freePath, sourcesUnchanged, type Mapping, type NoteError, type NoteInput, type Plan } from './fountain';
import { ExportModal } from './modal';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { DEFAULT_FILE_NAME, DEFAULT_SETTINGS, SceneNotesToFountainSettingTab, normalizeSettings, type SceneNotesToFountainSettings } from './settings';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

/** How often to ask the license state whether a check is due. It sends a request only when signed in and due (7 days). */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;

/** A plan and the exact note texts that it was built from. */
export interface SavePlan {
	plan: Plan;
	texts: Record<string, string>;
}

export type SaveResult = { status: 'saved'; file: TFile } | { status: 'stale' } | { status: 'invalid'; errors: NoteError[] };

export default class SceneNotesToFountainPlugin extends Plugin {
	settings: SceneNotesToFountainSettings = { ...DEFAULT_SETTINGS, groups: [] };
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	private settingTab: SceneNotesToFountainSettingTab | null = null;

	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		// No request here: a request needs a GitHub sign in first (Settings, Pro, Sign in with GitHub).
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		this.register(pro.onChange(() => this.settingTab?.update()));
		this.settingTab = new SceneNotesToFountainSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		this.addCommand({
			id: 'export-outline',
			name: 'Export notes to a .fountain outline',
			callback: () => {
				this.openExport();
			},
		});
		this.addCommand({
			id: 'export-groups',
			name: 'Export saved note groups',
			callback: () => void this.exportGroups(),
		});
		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
		});
	}

	onunload(): void {
		resetPro();
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<SceneNotesToFountainSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Opens the export window for a folder: the given one, the folder of the active note, or the vault root. */
	openExport(folder?: string): ExportModal {
		const active = this.app.workspace.getActiveFile();
		const modal = new ExportModal(this, folder ?? active?.parent?.path ?? '/');
		modal.open();
		return modal;
	}

	/** Property names in use: the saved mapping with Pro, else "slugline" and "synopsis". */
	mapping(): Mapping {
		return isPro() ? { slugline: this.settings.sluglineProperty, synopsis: this.settings.synopsisProperty } : { ...DEFAULT_MAPPING };
	}

	/** File name in use: the saved name with Pro, else "Outline". */
	defaultFileName(): string {
		return isPro() ? this.settings.fileName : DEFAULT_FILE_NAME;
	}

	/** Folders that hold Markdown notes, sorted by path. The vault root is "/". */
	folders(): string[] {
		const set = new Set<string>();
		for (const f of this.app.vault.getMarkdownFiles()) set.add(f.parent?.path ?? '/');
		return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
	}

	/** Markdown notes directly in a folder (not in subfolders), in file-name order. */
	notesIn(folder: string): TFile[] {
		return this.app.vault
			.getMarkdownFiles()
			.filter((f) => (f.parent?.path ?? '/') === folder)
			.sort((a, b) => a.basename.localeCompare(b.basename, undefined, { numeric: true }));
	}

	/** Reads the notes at paths. A missing note or bad frontmatter becomes an error. Nothing is written. */
	async readNotes(paths: string[]): Promise<{ inputs: NoteInput[]; texts: Record<string, string>; errors: NoteError[] }> {
		const inputs: NoteInput[] = [];
		const texts: Record<string, string> = {};
		const errors: NoteError[] = [];
		for (const path of paths) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) {
				errors.push({ path, message: 'The note is not in the vault now.' });
				continue;
			}
			const text = await this.app.vault.read(file);
			texts[path] = text;
			const info = getFrontMatterInfo(text);
			let frontmatter: Record<string, unknown> | null = null;
			if (info.exists) {
				try {
					const parsed: unknown = parseYaml(info.frontmatter);
					if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) frontmatter = parsed as Record<string, unknown>;
				} catch {
					errors.push({ path, message: 'The properties are not valid YAML.' });
					continue;
				}
			}
			inputs.push({ path, title: file.basename, frontmatter, body: text.slice(info.contentStart) });
		}
		return { inputs, texts, errors };
	}

	/** Builds the preview plan for notes in this order. */
	async makePlan(paths: string[]): Promise<SavePlan> {
		const { inputs, texts, errors } = await this.readNotes(paths);
		const plan = buildPlan(inputs, this.mapping());
		if (errors.length) {
			const order = new Map(paths.map((p, i) => [p, i]));
			plan.errors = [...plan.errors, ...errors].sort((a, b) => (order.get(a.path) ?? -1) - (order.get(b.path) ?? -1));
			plan.text = null;
		}
		return { plan, texts };
	}

	/** Output folder: the saved folder with Pro, else the folder of the notes. */
	outputFolder(notesFolder: string): string {
		const f = isPro() && this.settings.outputFolder ? this.settings.outputFolder : notesFolder;
		return f === '/' ? '' : normalizePath(f);
	}

	/**
	 * Writes the plan to a new .fountain file. Reads each source note again first; if one changed, it writes nothing
	 * and returns "stale". It never writes to a source note or to an existing file.
	 */
	async savePlan(sp: SavePlan, notesFolder: string, fileName: string): Promise<SaveResult> {
		if (sp.plan.text === null) return { status: 'invalid', errors: sp.plan.errors };
		const now = await this.readNotes(Object.keys(sp.texts));
		if (now.errors.length || !sourcesUnchanged(sp.texts, now.texts)) return { status: 'stale' };
		const folder = this.outputFolder(notesFolder);
		if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
		const path = normalizePath(freePath(folder, cleanFileName(fileName), (p) => this.app.vault.getAbstractFileByPath(normalizePath(p)) !== null));
		const file = await this.app.vault.create(path, sp.plan.text);
		return { status: 'saved', file };
	}

	/** Pro: saves the selection and its order as a named group. A group with the same name is replaced. */
	async saveGroup(name: string, folder: string, paths: string[]): Promise<boolean> {
		if (!isPro()) {
			needsPro('Saved note groups');
			return false;
		}
		const clean = cleanFileName(name);
		const groups = this.settings.groups.filter((g) => g.name !== clean);
		groups.push({ name: clean, folder, paths: [...paths] });
		this.settings.groups = groups;
		await this.saveSettings();
		this.settingTab?.update();
		return true;
	}

	async deleteGroup(i: number): Promise<void> {
		this.settings.groups = this.settings.groups.filter((_, j) => j !== i);
		await this.saveSettings();
	}

	/** Pro: exports each saved group to its own new .fountain file, named after the group. Returns the new paths. */
	async exportGroups(): Promise<string[]> {
		if (!isPro()) {
			needsPro('Export of saved note groups');
			return [];
		}
		const groups = this.settings.groups;
		if (!groups.length) {
			new Notice('There are no saved note groups. Save one from the export window first.');
			return [];
		}
		const saved: string[] = [];
		const failed: string[] = [];
		for (const g of groups) {
			try {
				const sp = await this.makePlan(g.paths);
				const r = await this.savePlan(sp, g.folder, g.name);
				if (r.status === 'saved') saved.push(r.file.path);
				else failed.push(`${g.name}: ${r.status === 'invalid' ? (r.errors[0]?.message ?? 'error') : 'a note changed'}`);
			} catch (e) {
				failed.push(`${g.name}: ${errorText(e)}`);
			}
		}
		new Notice(`Saved ${saved.length} of ${groups.length} groups.${failed.length ? ` Not saved: ${failed.join('; ')}` : ''}`);
		return saved;
	}
}

export function needsPro(feature: string): void {
	new Notice(`${feature} is a Pro feature. Sponsor on GitHub, then sign in from the plugin settings.`);
}
