import { Notice, Plugin, TFile, normalizePath } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { DEFAULT_SETTINGS, FlattenTableSettingTab, normalizeSettings, type FlattenTableSettings } from './settings';
import { toCsv, toMarkdown } from './flatten';
import { FlattenView, VIEW_ID, viewOptions } from './view';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

/** How often to ask the license state whether a check is due. It sends a request only when signed in and due (7 days). */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;

export default class FlattenTablePlugin extends Plugin {
	settings: FlattenTableSettings = { ...DEFAULT_SETTINGS };
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	private settingTab: FlattenTableSettingTab | null = null;
	/** Open flat table views. A view adds itself when loaded and removes itself on unload. */
	readonly views = new Set<FlattenView>();

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
		this.settingTab = new FlattenTableSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		this.registerHoverLinkSource(VIEW_ID, { display: 'Flatten Table', defaultMod: true });
		const ok = this.registerBasesView(VIEW_ID, {
			name: 'Flatten table',
			icon: 'rows-3',
			factory: (controller, containerEl) => new FlattenView(controller, containerEl, this),
			options: viewOptions,
		});
		if (!ok) console.warn('Flatten Table: Bases is turned off in this vault, so the view is not available.');
		this.addExportCommand('export-markdown', 'Export the flat table as a Markdown note', 'markdown');
		this.addExportCommand('export-csv', 'Export the flat table as a CSV file', 'csv');
		this.app.workspace.onLayoutReady(() => {
			void this.reopenStaleBases();
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
		});
	}

	onunload(): void {
		resetPro();
	}

	/**
	 * After a plugin update or reload, Bases keeps showing the views of the old plugin code: they miss Pro and
	 * the export commands. This opens each such base tab again, so its view runs the current code. A first start finds none.
	 */
	async reopenStaleBases(): Promise<number> {
		let n = 0;
		for (const leaf of this.app.workspace.getLeavesOfType('bases')) {
			const el = leaf.view.containerEl;
			const stale = el.querySelector('.flatten-table') !== null && ![...this.views].some((v) => el.contains(v.containerEl));
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

	/** The flat table view in the active tab, or else the one drawn last. */
	targetView(): FlattenView | null {
		const open = [...this.views].filter((v) => v.last !== null);
		return open.find((v) => v.isActive()) ?? open[open.length - 1] ?? null;
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<FlattenTableSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Pro: writes the flat table of a view to a new Markdown note or CSV file and opens it. */
	async exportView(view: FlattenView, kind: 'markdown' | 'csv'): Promise<TFile | null> {
		if (!isPro()) {
			FlattenView.needsPro('Export');
			return null;
		}
		const r = view.last;
		if (!r) return null;
		const stamp = timeStamp(new Date());
		const title = `${(view.config.name || 'Flatten table').replace(/[\\/:*?"<>|#^[\]]/g, ' ').trim()} ${stamp}`;
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
