import { Notice, Plugin, TFile, normalizePath } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { DEFAULT_SETTINGS, NoteRisExportSettingTab, normalizeSettings, type NoteRisExportSettings } from './settings';
import { buildRis, byPath, checkSources, freePath, inFolder, matchesFilter, parseFilter, type FieldMap, type Problem, type Source } from './ris';
import { ExportModal } from './modal';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

/** How long the Pro repeat waits after the last mapped change before it writes. */
export const REPEAT_DELAY_MS = 2000;

export type CollectState = 'ok' | 'no-folder' | 'empty' | 'not-ready' | 'bad-filter' | 'no-match';

export interface Collected {
	state: CollectState;
	/** One sentence for the user. */
	message: string;
	/** The notes in the folder, before the filter. */
	total: number;
	sources: Source[];
}

export interface Preview extends Collected {
	problems: Problem[];
}

/** FNV-1a 32-bit hash as 8 hex digits. Used only to see if a file still holds the text that the plugin wrote. */
export function hash(text: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h.toString(16).padStart(8, '0');
}

export default class NoteRisExportPlugin extends Plugin {
	settings: NoteRisExportSettings = { ...DEFAULT_SETTINGS };
	pro: SponsorsManager | null = null;
	modal: ExportModal | null = null;
	private settingTab: NoteRisExportSettingTab | null = null;
	private repeatTimer: number | null = null;
	/** The repeat that runs now. A second repeat waits for it, so two repeats do not write two files. */
	private repeating: Promise<unknown> = Promise.resolve();
	private stopped = false;

	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		this.stopped = false;
		await this.loadSettings();
		// No request here: a request needs a GitHub sign in first (Settings, Pro, Sign in with GitHub).
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		this.settingTab = new NoteRisExportSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		this.register(pro.onChange(() => this.settingTab?.update()));
		this.addCommand({ id: 'open-export', name: 'Export reference notes to a .ris file', callback: () => this.openModal() });
		this.addCommand({ id: 'repeat-export', name: 'Repeat the last .ris export (pro)', callback: () => void this.repeatLast() });
		this.registerEvent(this.app.metadataCache.on('changed', (file) => this.onChanged(file)));
		this.app.workspace.onLayoutReady(() => {
			if (this.stopped) return;
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
		});
	}

	onunload(): void {
		this.stopped = true;
		if (this.repeatTimer !== null) window.clearTimeout(this.repeatTimer);
		this.modal?.close();
		resetPro();
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<NoteRisExportSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	openModal(): void {
		if (this.stopped) return;
		this.modal?.close();
		this.modal = new ExportModal(this);
		this.modal.open();
	}

	needsPro(feature: string): boolean {
		if (isPro()) return false;
		new Notice(`${feature} is a Pro feature. Sponsor on GitHub, then sign in from the plugin settings.`);
		return true;
	}

	/** The field map of the export: the Pro named map in use, else the map of the settings. */
	currentMap(): FieldMap {
		if (isPro() && this.settings.activeMap) {
			const m = this.settings.maps.find((x) => x.name === this.settings.activeMap);
			if (m) return m.map;
		}
		return this.settings.map;
	}

	/** Reads the notes of a folder from the metadata cache. The filter is Pro; without Pro it has no effect. */
	collect(folderInput: string, filterText = ''): Collected {
		const folder = normalizePath(folderInput.trim() || '/');
		const root = folder === '/' || folder === '';
		const label = root ? 'the vault root' : folder;
		const none = (state: CollectState, message: string, total = 0): Collected => ({ state, message, total, sources: [] });
		if (!root && !this.app.vault.getFolderByPath(folder)) return none('no-folder', `Folder ${folder} does not exist.`);
		const files = this.app.vault.getMarkdownFiles().filter((f) => inFolder(f.path, root ? '' : folder)).sort(byPath);
		if (files.length === 0) return none('empty', `No Markdown notes in ${label}. Nothing to export.`);
		const sources: Source[] = [];
		let waiting = 0;
		for (const f of files) {
			const cache = this.app.metadataCache.getFileCache(f);
			if (!cache) waiting++;
			else sources.push({ path: f.path, props: cache.frontmatter ?? null });
		}
		if (waiting > 0) return none('not-ready', `The metadata cache is not ready for ${waiting} of ${files.length} notes in ${label}. Wait for Obsidian to index the vault, then try again.`, files.length);
		const n = files.length;
		let picked = sources;
		let message = `${n} reference note${n === 1 ? '' : 's'} in ${label}.`;
		if (filterText.trim() && isPro()) {
			const filter = parseFilter(filterText);
			if (!filter) return none('bad-filter', 'Write the filter as key = value, for example collection = thesis.', n);
			picked = sources.filter((s) => matchesFilter(s.props, filter));
			if (picked.length === 0) return none('no-match', `No note in ${label} has ${filter.key} = ${filter.value}.`, n);
			message = `${picked.length} of ${n} reference notes in ${label} match ${filter.key} = ${filter.value}.`;
		}
		return { state: 'ok', message, total: n, sources: picked };
	}

	preview(folder: string, filter = ''): Preview {
		const c = this.collect(folder, filter);
		return { ...c, problems: c.state === 'ok' ? checkSources(c.sources, this.currentMap()) : [] };
	}

	/** Writes a new RIS file. Gives its path, or null when the data or the folder stops the export. */
	async exportRis(folder: string, filter = ''): Promise<string | null> {
		const c = this.collect(folder, filter);
		if (c.state !== 'ok') {
			new Notice(c.message);
			return null;
		}
		const r = buildRis(c.sources, this.currentMap());
		if (!r.ok) {
			new Notice(`Export stopped: ${r.problems.length} note${r.problems.length === 1 ? ' has' : 's have'} missing or invalid fields. No file was written.`);
			return null;
		}
		const path = await this.writeNew(r.text);
		if (!path) return null;
		this.settings.last = { folder, filter: isPro() ? filter : '', path, hash: hash(r.text) };
		await this.saveSettings();
		new Notice(`Saved ${r.count} reference${r.count === 1 ? '' : 's'} to ${path}`);
		return path;
	}

	/** Creates a new file with a free name next to the output path. Never replaces a file. */
	private async writeNew(text: string): Promise<string | null> {
		const out = normalizePath(this.settings.output.trim() || DEFAULT_SETTINGS.output);
		const parent = out.includes('/') ? out.slice(0, out.lastIndexOf('/')) : '';
		if (parent && !this.app.vault.getFolderByPath(parent)) {
			new Notice(`Output folder ${parent} does not exist. No file was written.`);
			return null;
		}
		const path = freePath(out, (p) => this.app.vault.getAbstractFileByPath(p) !== null);
		await this.app.vault.create(path, text);
		return path;
	}

	async saveMap(name: string): Promise<boolean> {
		if (this.needsPro('Named field maps')) return false;
		const n = name.trim();
		if (!n) {
			new Notice('Enter a name for the field map.');
			return false;
		}
		this.settings.maps = this.settings.maps.filter((m) => m.name !== n);
		this.settings.maps.push({ name: n, map: { ...this.settings.map } });
		await this.saveSettings();
		new Notice(`Saved the field map ${n}.`);
		return true;
	}

	async useMap(name: string): Promise<boolean> {
		if (name && this.needsPro('Named field maps')) return false;
		if (name && !this.settings.maps.some((m) => m.name === name)) return false;
		this.settings.activeMap = name;
		await this.saveSettings();
		return true;
	}

	async deleteMap(name: string): Promise<void> {
		this.settings.maps = this.settings.maps.filter((m) => m.name !== name);
		if (this.settings.activeMap === name) this.settings.activeMap = '';
		await this.saveSettings();
	}

	async setRepeat(on: boolean): Promise<boolean> {
		if (on && this.needsPro('Repeat export')) return false;
		this.settings.repeat = on;
		if (!on && this.repeatTimer !== null) {
			window.clearTimeout(this.repeatTimer);
			this.repeatTimer = null;
		}
		await this.saveSettings();
		return true;
	}

	private onChanged(file: TFile): void {
		const last = this.settings.last;
		if (!this.settings.repeat || !last || !isPro() || this.stopped) return;
		const folder = normalizePath(last.folder.trim() || '/');
		if (!inFolder(file.path, folder === '/' ? '' : folder)) return;
		if (this.repeatTimer !== null) window.clearTimeout(this.repeatTimer);
		this.repeatTimer = window.setTimeout(() => {
			this.repeatTimer = null;
			void this.repeatLast(true);
		}, REPEAT_DELAY_MS);
	}

	/**
	 * Pro: runs the last export again. The result is "unchanged" when the RIS text is the same, "updated" when the
	 * plugin wrote its own unchanged file again, "new" when it saved a new file, "blocked" when data stops it.
	 */
	repeatLast(quiet = false): Promise<'none' | 'unchanged' | 'updated' | 'new' | 'blocked'> {
		const run = this.repeating.then(() => this.repeatOnce(quiet));
		this.repeating = run.catch(() => undefined);
		return run;
	}

	private async repeatOnce(quiet: boolean): Promise<'none' | 'unchanged' | 'updated' | 'new' | 'blocked'> {
		if (this.needsPro('Repeat export')) return 'blocked';
		const last = this.settings.last;
		if (!last) {
			new Notice('No export to repeat. Export once from the export window first.');
			return 'none';
		}
		const c = this.collect(last.folder, last.filter);
		const r = c.state === 'ok' ? buildRis(c.sources, this.currentMap()) : null;
		if (!r || !r.ok) {
			if (!quiet || c.state !== 'not-ready') new Notice(r ? 'Repeat export stopped: some notes have missing or invalid fields. Open the export window to see them.' : c.message);
			return 'blocked';
		}
		const h = hash(r.text);
		const old = this.app.vault.getAbstractFileByPath(last.path);
		if (h === last.hash && old) return 'unchanged';
		let path: string | null = null;
		let result: 'updated' | 'new' = 'new';
		if (old instanceof TFile) {
			// One atomic edit: the check of the old text and the write cannot miss a change that comes between them.
			let mine = false;
			await this.app.vault.process(old, (data) => {
				mine = hash(data) === last.hash;
				return mine ? r.text : data;
			});
			if (mine) {
				path = old.path;
				result = 'updated';
			}
		}
		if (!path) path = await this.writeNew(r.text);
		if (!path) return 'blocked';
		this.settings.last = { ...last, path, hash: h };
		await this.saveSettings();
		new Notice(`Repeat export: ${r.count} reference${r.count === 1 ? '' : 's'} in ${path}`);
		return result;
	}
}
