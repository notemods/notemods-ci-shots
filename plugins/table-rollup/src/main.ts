import { Notice, Plugin, TFile, normalizePath } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { DEFAULT_SETTINGS, TableRollupSettingTab, normalizeSettings, type TableRollupSettings } from './settings';
import { findTables, toCsv, toMarkdown, type Mode, type ParsedTable, type SourceNote } from './table';
import { RollupView, VIEW_ID, viewOptions } from './view';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

interface CacheEntry {
	mtime: number;
	size: number;
	markdown: string;
	tables: ParsedTable[] | null;
}

/** Section types that can hold a pipe table (a table can sit inside a callout or a quote). */
const TABLE_SECTIONS = new Set(['table', 'callout', 'blockquote']);
/** How often to ask the license state whether a check is due. It sends a request only when signed in and due (7 days). */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;

export default class TableRollupPlugin extends Plugin {
	settings: TableRollupSettings = { ...DEFAULT_SETTINGS };
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	private settingTab: TableRollupSettingTab | null = null;
	/** Open rollup views. A view adds itself when created and removes itself on unload. */
	readonly views = new Set<RollupView>();
	/** Note text and parsed tables by path, checked against mtime and size. */
	private cache = new Map<string, CacheEntry>();

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
		this.settingTab = new TableRollupSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		this.registerHoverLinkSource(VIEW_ID, { display: 'Table Rollup', defaultMod: true });
		const ok = this.registerBasesView(VIEW_ID, {
			name: 'Table rollup',
			icon: 'table-properties',
			factory: (controller, containerEl) => new RollupView(controller, containerEl, this),
			options: viewOptions,
		});
		if (!ok) console.warn('Table Rollup: Bases is turned off in this vault, so the view is not available.');
		this.registerEvent(this.app.vault.on('delete', (f) => this.cache.delete(f.path)));
		this.registerEvent(this.app.vault.on('rename', (_f, old) => this.cache.delete(old)));
		this.addExportCommand('export-markdown', 'Export the merged table as a Markdown note', 'markdown');
		this.addExportCommand('export-csv', 'Export the merged table as a CSV file', 'csv');
		this.app.workspace.onLayoutReady(() => {
			void this.reopenStaleBases();
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
		});
	}

	onunload(): void {
		resetPro();
		this.cache.clear();
	}

	/**
	 * After a plugin update or reload, Bases keeps showing the rollup views of the old plugin code: they miss Pro and
	 * the export commands. This opens each such base tab again, so its view runs the current code. A first start finds none.
	 */
	async reopenStaleBases(): Promise<number> {
		let n = 0;
		for (const leaf of this.app.workspace.getLeavesOfType('bases')) {
			const el = leaf.view.containerEl;
			const stale = el.querySelector('.table-rollup') !== null && ![...this.views].some((v) => el.contains(v.containerEl));
			if (!stale) continue;
			const state = leaf.getViewState();
			await leaf.setViewState({ type: 'empty' });
			await leaf.setViewState(state);
			n++;
		}
		return n;
	}

	private addExportCommand(id: string, name: string, kind: 'markdown' | 'csv'): void {
		this.addCommand({
			id,
			name,
			checkCallback: (checking) => {
				const view = this.targetView();
				if (!view) return false;
				if (!checking) void this.exportView(view, kind);
				return true;
			},
		});
	}

	/** The rollup view in the active tab, or else the one drawn last. */
	targetView(): RollupView | null {
		const open = [...this.views].filter((v) => v.last !== null);
		return open.find((v) => v.isActive()) ?? open[open.length - 1] ?? null;
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<TableRollupSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/**
	 * Text of one note for the rollup. The metadata cache tells which notes hold no table (or no task), so those
	 * are not read. Parsed tables are kept until the note changes.
	 */
	async readNote(file: TFile, mode: Mode): Promise<SourceNote> {
		const meta = this.app.metadataCache.getFileCache(file);
		if (meta) {
			const has = mode === 'tasks' ? (meta.listItems ?? []).some((li) => li.task !== undefined) : (meta.sections ?? []).some((s) => TABLE_SECTIONS.has(s.type));
			if (!has) return { path: file.path, markdown: '', tables: [] };
		}
		const hit = this.cache.get(file.path);
		if (hit && hit.mtime === file.stat.mtime && hit.size === file.stat.size) {
			if (mode === 'tables' && !hit.tables) hit.tables = findTables(hit.markdown);
			return { path: file.path, markdown: hit.markdown, tables: mode === 'tables' ? (hit.tables ?? undefined) : undefined };
		}
		const markdown = await this.app.vault.cachedRead(file);
		const tables = mode === 'tables' ? findTables(markdown) : null;
		this.cache.set(file.path, { mtime: file.stat.mtime, size: file.stat.size, markdown, tables });
		return { path: file.path, markdown, tables: tables ?? undefined };
	}

	/** Pro: writes the merged table of a view to a new Markdown note or CSV file and opens it. */
	async exportView(view: RollupView | null, kind: 'markdown' | 'csv'): Promise<TFile | null> {
		if (!isPro()) {
			RollupView.needsPro('Export');
			return null;
		}
		const r = view?.last;
		if (!view || !r) return null;
		const stamp = timeStamp(new Date());
		const title = `${(view.config.name || 'Table rollup').replace(/[\\/:*?"<>|#^[\]]/g, ' ').trim()} ${stamp}`;
		const ext = kind === 'markdown' ? 'md' : 'csv';
		const body = kind === 'markdown' ? `# ${title}\n\n${r.rows.length} rows from ${r.sources} notes.\n\n${toMarkdown(r, view.lastShowSource)}` : toCsv(r, view.lastShowSource);
		const folder = this.app.fileManager.getNewFileParent('');
		const base = normalizePath(`${folder.path === '/' ? '' : folder.path + '/'}${title}`);
		let path = `${base}.${ext}`;
		for (let n = 2; this.app.vault.getAbstractFileByPath(path) && n < 1000; n++) path = `${base} ${n}.${ext}`;
		const file = await this.app.vault.create(path, body);
		new Notice(`Exported ${r.rows.length} rows to ${file.path}`);
		if (kind === 'markdown') await this.app.workspace.getLeaf('tab').openFile(file);
		return file;
	}
}

const pad2 = (n: number): string => String(n).padStart(2, '0');
/** Local time as YYYY-MM-DD HHmm. Plain Date, so the code does not depend on the moment types. */
export function timeStamp(d: Date): string {
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}
