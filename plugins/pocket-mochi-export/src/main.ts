import { FuzzySuggestModal, Notice, Plugin, TFile, TFolder, normalizePath, type App, type Menu, type TAbstractFile } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { buildArchive } from './archive';
import { archivePath, normalizeTag, parsePresets, planExport, type DeckMode, type ExportPlan, type Preset } from './mochi';
import { confirmExport } from './preview';
import { SPONSORS, bindPro, isPro, resetPro, proNotice } from './pro';
import { DEFAULT_SETTINGS, PocketMochiExportSettingTab, normalizeSettings, type PocketMochiExportSettings } from './settings';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

/** How often to ask the license state whether a check is due. It sends a request only when signed in and due (7 days). */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;

export interface ExportRequest {
	notes: TFile[];
	tag: string;
	folder: string;
	/** Name of the .mochi file, without the extension. */
	archiveName: string;
	/** Deck name for a single note; empty gives the note base name. */
	deck?: string;
	mode?: DeckMode;
	parentName?: string;
}

/** The Markdown files in a folder and its subfolders, sorted by path. */
export function notesIn(folder: TFolder): TFile[] {
	const out: TFile[] = [];
	const walk = (f: TFolder) => {
		for (const c of f.children) {
			if (c instanceof TFolder) walk(c);
			else if (c instanceof TFile && c.extension === 'md') out.push(c);
		}
	};
	walk(folder);
	return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Shows the Pro notice. The lead is a full sentence, for example 'Presets are a Pro feature.'. */
export function needsPro(lead: string): void {
	proNotice(lead);
}

class PresetModal extends FuzzySuggestModal<Preset> {
	constructor(
		app: App,
		private readonly presets: Preset[],
		private readonly choose: (p: Preset) => void,
	) {
		super(app);
		this.setPlaceholder('Choose a preset');
	}

	getItems(): Preset[] {
		return this.presets;
	}

	getItemText(p: Preset): string {
		return p.name;
	}

	onChooseItem(p: Preset): void {
		this.choose(p);
	}
}

export default class PocketMochiExportPlugin extends Plugin {
	settings: PocketMochiExportSettings = { ...DEFAULT_SETTINGS };
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	private settingTab: PocketMochiExportSettingTab | null = null;
	/** Shows the preview and gives the answer. The end-to-end test and the screenshots use the real modal. */
	confirm: (plan: ExportPlan, target: string) => Promise<boolean> = (plan, target) => confirmExport(this.app, plan, target);

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
		this.settingTab = new PocketMochiExportSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		this.addCommand({
			id: 'export-active-note',
			name: 'Export active note to a .mochi file',
			checkCallback: (checking) => {
				const file = this.activeNote();
				if (!file) return false;
				if (!checking) void this.exportNote(file);
				return true;
			},
		});
		this.addCommand({
			id: 'export-folder-decks',
			name: 'Export folder of active note, one deck for each note',
			checkCallback: (checking) => {
				const folder = this.activeNote()?.parent;
				if (!folder) return false;
				if (!checking) void this.exportFolder(folder, 'one-deck-per-note');
				return true;
			},
		});
		this.addCommand({
			id: 'export-folder-subdecks',
			name: 'Export folder of active note as one deck with sub-decks',
			checkCallback: (checking) => {
				const folder = this.activeNote()?.parent;
				if (!folder) return false;
				if (!checking) void this.exportFolder(folder, 'sub-decks');
				return true;
			},
		});
		this.addCommand({
			id: 'export-with-preset',
			name: 'Export active note with a preset',
			checkCallback: (checking) => {
				const file = this.activeNote();
				if (!file) return false;
				if (!checking) this.choosePreset(file);
				return true;
			},
		});
		this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => this.fillFileMenu(menu, file)));
		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
		});
	}

	onunload(): void {
		resetPro();
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<PocketMochiExportSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private activeNote(): TFile | null {
		const f = this.app.workspace.getActiveFile();
		return f && f.extension === 'md' ? f : null;
	}

	private fillFileMenu(menu: Menu, file: TAbstractFile): void {
		if (file instanceof TFile && file.extension === 'md') {
			menu.addItem((i) =>
				i
					.setTitle('Export to a .mochi file')
					.setIcon('package')
					.onClick(() => void this.exportNote(file)),
			);
		} else if (file instanceof TFolder) {
			menu.addItem((i) =>
				i
					.setTitle('Export folder to .mochi, one deck for each note')
					.setIcon('package')
					.onClick(() => void this.exportFolder(file, 'one-deck-per-note')),
			);
			menu.addItem((i) =>
				i
					.setTitle('Export folder to .mochi with sub-decks')
					.setIcon('package')
					.onClick(() => void this.exportFolder(file, 'sub-decks')),
			);
		}
	}

	/** Free: one note, one deck named after the note. */
	exportNote(file: TFile): Promise<string | null> {
		return this.runExport({ notes: [file], tag: this.settings.tag, folder: this.settings.folder, archiveName: file.basename });
	}

	/** Pro: the notes of a folder and its subfolders. */
	async exportFolder(folder: TFolder, mode: DeckMode): Promise<string | null> {
		if (!isPro()) {
			needsPro(mode === 'sub-decks' ? 'Folder export with sub-decks is a Pro feature.' : 'Folder export is a Pro feature.');
			return null;
		}
		const name = folder.isRoot() ? this.app.vault.getName() : folder.name;
		return this.runExport({ notes: notesIn(folder), tag: this.settings.tag, folder: this.settings.folder, archiveName: name, mode, parentName: name });
	}

	/** Pro: tag, output folder and deck name from a named preset. */
	exportWithPreset(file: TFile, preset: Preset): Promise<string | null> {
		if (!isPro()) {
			needsPro('Presets are a Pro feature.');
			return Promise.resolve(null);
		}
		const tag = normalizeTag(preset.tag) || this.settings.tag;
		const folder = preset.folder.trim().replace(/^\/+|\/+$/g, '') || this.settings.folder;
		const deck = preset.deck.trim();
		return this.runExport({ notes: [file], tag, folder, deck, archiveName: deck || file.basename });
	}

	private choosePreset(file: TFile): void {
		if (!isPro()) {
			needsPro('Presets are a Pro feature.');
			return;
		}
		const presets = parsePresets(this.settings.presets);
		if (presets.length === 0) {
			new Notice('No presets. Add one in the plugin settings.');
			return;
		}
		new PresetModal(this.app, presets, (p) => void this.exportWithPreset(file, p)).open();
	}

	/** True when the path or the same path in other letter case exists. Desktop and mobile file systems often ignore case. */
	private pathTaken(path: string): boolean {
		if (this.app.vault.getAbstractFileByPath(path)) return true;
		const cut = path.lastIndexOf('/');
		const parent = cut < 0 ? this.app.vault.getRoot() : this.app.vault.getFolderByPath(path.slice(0, cut));
		const lower = path.toLowerCase();
		return parent?.children.some((c) => c.path.toLowerCase() === lower) ?? false;
	}

	/** Reads the notes, shows the preview, then writes the .mochi file. Gives its vault path, or null. */
	async runExport(req: ExportRequest): Promise<string | null> {
		try {
			const notes = await Promise.all(req.notes.map(async (f, i) => ({ path: f.path, text: await this.app.vault.read(f), deck: i === 0 && req.notes.length === 1 ? req.deck : undefined })));
			const resolve = (link: string, source: string) => this.app.metadataCache.getFirstLinkpathDest(link, source)?.path ?? null;
			const plan = planExport(notes, resolve, { tag: req.tag, mode: req.mode, parentName: req.parentName });
			if (plan.cardCount === 0) {
				new Notice('No cards found');
				return null;
			}
			const exists = (p: string) => this.pathTaken(normalizePath(p));
			let target = normalizePath(archivePath(req.folder, req.archiveName, exists));
			if (!(await this.confirm(plan, target))) return null;
			// A file with this name can appear while the preview is open (for example a second export).
			if (exists(target)) target = normalizePath(archivePath(req.folder, req.archiveName, exists));
			const media: { name: string; data: Uint8Array }[] = [];
			for (const m of plan.media) {
				const f = this.app.vault.getFileByPath(m.path);
				if (f) media.push({ name: m.name, data: new Uint8Array(await this.app.vault.readBinary(f)) });
			}
			const bytes = buildArchive(plan.edn, media);
			const dir = target.includes('/') ? target.slice(0, target.lastIndexOf('/')) : '';
			if (dir && this.app.vault.getAbstractFileByPath(dir) === null) await this.app.vault.createFolder(dir);
			const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
			await this.app.vault.createBinary(target, buf);
			const missing = plan.missing.length ? ` Missing: ${plan.missing.join(', ')}.` : '';
			new Notice(`Exported ${plan.cardCount} card${plan.cardCount === 1 ? '' : 's'} to ${target}.${missing}`);
			return target;
		} catch (e) {
			console.error('Pocket Mochi Export: export failed', e);
			new Notice(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
			return null;
		}
	}
}
