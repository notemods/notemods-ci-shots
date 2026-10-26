import { FileView, Notice, Plugin, normalizePath, type TFile, type WorkspaceLeaf } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { SPONSORS, bindPro, isPro, onProChange, resetPro, proNotice } from './pro';
import { ReportModal } from './report';
import { inFolders, parseFolders, reportMarkdown, scanScripts, type ResolvedRef, type ScanResult, type ScriptInput } from './scan';
import { DEFAULT_SETTINGS, FountainReferencePanelSettingTab, normalizeSettings, type FountainReferencePanelSettings } from './settings';
import { ReferenceView, VIEW_TYPE } from './view';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

/** How often to ask the license state whether a check is due. It sends a request only when signed in and due (7 days). */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;

export const VIEWER_NEEDED = 'This app has no view for .fountain files, so the script did not open. Install a plugin that shows Fountain files. The row and its path stay in the panel.';

/** "2026-10-10 1857" in local time, for report file names. */
export function fileStamp(d: Date): string {
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`;
}

export default class FountainReferencePanelPlugin extends Plugin {
	settings: FountainReferencePanelSettings = { ...DEFAULT_SETTINGS };
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	/** The last scan of saved .fountain files, or null before the first scan. */
	scan: ScanResult | null = null;
	scannedAt = '';
	/** True when the last scan used project folders. The status line describes the last scan, not the current settings. */
	scanFiltered = false;
	scanning = false;
	/** The scan in progress. A second Refresh during a scan waits for this scan and does not start another. */
	private pending: Promise<ScanResult> | null = null;
	private settingTab: FountainReferencePanelSettingTab | null = null;

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
		this.register(onProChange(() => this.renderViews()));
		this.settingTab = new FountainReferencePanelSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		this.registerView(VIEW_TYPE, (leaf: WorkspaceLeaf) => new ReferenceView(leaf, this));
		this.addRibbonIcon('clapperboard', 'Open the reference panel', () => void this.openPanel());
		this.addCommand({ id: 'open-panel', name: 'Open the reference panel', callback: () => void this.openPanel() });
		this.addCommand({ id: 'refresh', name: 'Refresh the references from saved scripts', callback: () => void this.refresh() });
		this.addCommand({ id: 'export-report', name: 'Export a reference report for selected notes', callback: () => void this.openReport() });

		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
		});
	}

	onunload(): void {
		resetPro();
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<FountainReferencePanelSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** The project folders that the scan uses. Without Pro the list is empty, so the scan covers the whole vault. */
	activeFolders(): string[] {
		return isPro() ? parseFolders(this.settings.folders) : [];
	}

	views(): ReferenceView[] {
		return this.app.workspace
			.getLeavesOfType(VIEW_TYPE)
			.map((l) => l.view)
			.filter((v): v is ReferenceView => v instanceof ReferenceView);
	}

	private renderViews(): void {
		for (const v of this.views()) v.render();
	}

	/** Opens the panel in the right sidebar, or shows the open panel. The first open starts a scan. */
	async openPanel(): Promise<void> {
		let leaf: WorkspaceLeaf | null = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0] ?? null;
		if (!leaf) {
			leaf = this.app.workspace.getRightLeaf(false);
			if (!leaf) return;
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
		}
		await this.app.workspace.revealLeaf(leaf);
		if (this.scan === null) await this.refresh();
	}

	/** Reads the saved .fountain files and rebuilds the reference list. Old rows go away. */
	refresh(): Promise<ScanResult> {
		this.pending ??= this.runScan().finally(() => {
			this.pending = null;
		});
		return this.pending;
	}

	private async runScan(): Promise<ScanResult> {
		this.scanning = true;
		this.renderViews();
		try {
			const folders = this.activeFolders();
			const files = this.app.vault.getFiles().filter((f) => f.extension === 'fountain' && inFolders(f.path, folders));
			const inputs: ScriptInput[] = [];
			for (const f of files) {
				try {
					inputs.push({ path: f.path, text: await this.app.vault.cachedRead(f) });
				} catch (e) {
					inputs.push({ path: f.path, error: e instanceof Error ? e.message : String(e) });
				}
			}
			this.scan = scanScripts(inputs, (linkpath, sourcePath) => this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath)?.path ?? null);
			this.scannedAt = fileStamp(new Date());
			this.scanFiltered = folders.length > 0;
			return this.scan;
		} finally {
			this.scanning = false;
			this.renderViews();
		}
	}

	/** Opens the script of a row. If no view can show .fountain files, a notice explains it and the row stays. */
	async openSource(ref: ResolvedRef): Promise<boolean> {
		const file = this.app.vault.getFileByPath(ref.source);
		if (!file) {
			new Notice(`${ref.source} is no longer in the vault. Select Refresh to scan again.`);
			return false;
		}
		const leaf = this.app.workspace.getLeaf(false);
		try {
			await leaf.openFile(file);
		} catch (e) {
			console.warn('Fountain Reference Panel: could not open the script', e);
		}
		const view = leaf.view;
		if (!(view instanceof FileView) || view.file?.path !== file.path) {
			new Notice(VIEWER_NEEDED);
			return false;
		}
		return true;
	}

	/** Pro: the notes that have references in the last scan, with their counts. */
	referencedNotes(): { path: string; count: number }[] {
		const counts = new Map<string, number>();
		for (const r of this.scan?.refs ?? []) if (r.dest !== null && r.dest.endsWith('.md')) counts.set(r.dest, (counts.get(r.dest) ?? 0) + 1);
		return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([path, count]) => ({ path, count }));
	}

	async openReport(): Promise<void> {
		if (!isPro()) {
			proNotice('The reference report is a pro feature.');
			return;
		}
		if (this.scan === null) await this.refresh();
		new ReportModal(this.app, this.referencedNotes(), async (paths) => {
			await this.exportReport(paths);
		}).open();
	}

	/** Pro: writes the report for the notes to a new Markdown note in the folder for new notes. */
	async exportReport(paths: string[]): Promise<TFile | null> {
		if (!isPro()) return null;
		if (this.scan === null) await this.refresh();
		const scan = this.scan;
		if (!scan) return null;
		const stamp = fileStamp(new Date());
		const folder = this.app.fileManager.getNewFileParent('');
		const base = normalizePath(`${folder.path === '/' ? '' : folder.path + '/'}Fountain reference report ${stamp}`);
		let path = `${base}.md`;
		for (let n = 2; this.app.vault.getAbstractFileByPath(path) && n < 1000; n++) path = `${base} ${n}.md`;
		try {
			const file = await this.app.vault.create(path, reportMarkdown(paths, scan, this.scannedAt || stamp));
			new Notice(`Exported the references of ${paths.length} ${paths.length === 1 ? 'note' : 'notes'} to ${file.path}`);
			return file;
		} catch (e) {
			console.error('Fountain Reference Panel: export failed', e);
			new Notice(`Could not export the report: ${e instanceof Error ? e.message : String(e)}`);
			return null;
		}
	}
}
