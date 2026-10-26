import { Notice, Plugin, TFile, TFolder, normalizePath, type WorkspaceLeaf } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors, guardSponsorsPro } from './license/github-obsidian';
import ASCIIDOCTOR_CSS from '../node_modules/@asciidoctor/core/dist/css/asciidoctor.css';
import { exportPath, isOwnExport, standalonePage } from './adoc/export';
import { expandIncludes, expandWithReader, type ExpandResult } from './adoc/includes';
import { ADOC_EXTENSIONS, extOf, isAdocPath, withExt } from './adoc/paths';
import { sanitizeHtml } from './adoc/sanitize';
import { LINKS_VIEW_TYPE, LinksView } from './links-view';
import { SPONSORS, bindPro, isPro, onProChange } from './pro';
import { convert } from './render';
import { DEFAULT_SETTINGS, AsciidocFilesSettingTab, normalizeSettings, type AsciidocFilesSettings } from './settings';
import { AsciidocView, VIEW_TYPE } from './view';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

/** How often to ask the license state whether a check is due. It sends a request only when signed in and due (7 days). */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;
/** Upper bound of AsciiDoc files read for the incoming links list. */
const MAX_SCAN_FILES = 2000;
const NEW_FILE_TEXT = '= Untitled\n\nWrite here.\n';

export default class AsciidocFilesPlugin extends Plugin {
	settings: AsciidocFilesSettings = { ...DEFAULT_SETTINGS };
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	/** Extensions another plugin had already registered. */
	blockedExtensions: string[] = [];
	private settingTab: AsciidocFilesSettingTab | null = null;
	private pendingAnchors = new Map<string, string>();
	private lastView: AsciidocView | null = null;
	private linksTimer = 0;
	private docCache = new Map<string, { mtime: number; text: string }>();

	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		// No request here: a request needs a GitHub sign in first (Settings, Pro, Sign in with GitHub).
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		this.register(
			onProChange(() => {
				this.rerenderAll();
				this.settingTab?.update();
				this.refreshLinksSoon();
			}),
		);
		this.settingTab = new AsciidocFilesSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		this.registerView(VIEW_TYPE, (leaf) => new AsciidocView(leaf, this));
		this.registerView(LINKS_VIEW_TYPE, (leaf) => new LinksView(leaf, this));
		this.registerFileTypes();
		this.addCommands(pro);
		this.registerEvents();

		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
		});
	}

	onunload(): void {
		window.clearTimeout(this.linksTimer);
		bindPro(null);
	}

	/** Registers each extension on its own, so a conflict on one still opens the others. */
	private registerFileTypes(): void {
		for (const ext of ADOC_EXTENSIONS) {
			try {
				this.registerExtensions([ext], VIEW_TYPE);
			} catch {
				this.blockedExtensions.push(`.${ext}`);
			}
		}
		if (this.blockedExtensions.length) new Notice(`AsciiDoc Files: another plugin already opens ${this.blockedExtensions.join(', ')} files. Turn it off and restart the app.`, 10000);
	}

	private addCommands(pro: SponsorsManager): void {
		this.addCommand({ id: 'new-file', name: 'Create a new .adoc file', callback: () => void this.createFile(this.app.workspace.getActiveFile()?.parent ?? null) });
		this.addViewCommand('toggle-source', 'Switch between source and preview', (v) => v.setMode(v.mode === 'source' ? 'preview' : 'source'));
		this.addViewCommand('toggle-split', 'Show source and preview side by side', (v) => v.setMode(v.mode === 'split' ? 'preview' : 'split'));
		this.addCommand({ id: 'open-links', name: 'Open the outline and links panel', callback: guardSponsorsPro(pro, () => void this.openLinksPanel()) });
		this.addViewCommand('export-html', 'Export the current file to HTML', (v) => guardSponsorsPro(pro, () => void this.exportHtml(v))());
		this.addViewCommand('copy-html', 'Copy the current file as HTML', (v) => guardSponsorsPro(pro, () => void this.copyHtml(v))());
	}

	private addViewCommand(id: string, name: string, run: (view: AsciidocView) => void): void {
		this.addCommand({
			id,
			name,
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(AsciidocView);
				if (!view) return false;
				if (!checking) run(view);
				return true;
			},
		});
	}

	private registerEvents(): void {
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (!(file instanceof TFolder)) return;
				menu.addItem((item) => item.setTitle('New .adoc file').setIcon('file-code').onClick(() => void this.createFile(file)));
			}),
		);
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf: WorkspaceLeaf | null) => {
				if (leaf?.view instanceof AsciidocView) {
					this.lastView = leaf.view;
					this.refreshLinksSoon();
				}
			}),
		);
		const changed = (file: unknown): void => {
			if (file instanceof TFile && isAdocPath(file.path)) {
				this.docCache.delete(file.path);
				this.refreshLinksSoon();
			}
		};
		this.registerEvent(this.app.vault.on('modify', changed));
		this.registerEvent(this.app.vault.on('delete', changed));
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => (this.docCache.delete(oldPath), changed(file))));
		this.registerEvent(this.app.metadataCache.on('resolved', () => this.refreshLinksSoon()));
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<AsciidocFilesSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Pro from the cached GitHub Sponsors answer. Never sends a request. */
	isPro(): boolean {
		return isPro();
	}

	adocViews(): AsciidocView[] {
		return this.app.workspace.getLeavesOfType(VIEW_TYPE).map((l) => l.view).filter((v): v is AsciidocView => v instanceof AsciidocView);
	}

	rerenderAll(): void {
		for (const v of this.adocViews()) void v.render();
	}

	/** The AsciiDoc tab in focus, or the last one that had focus and is still open. */
	lastAdocView(): AsciidocView | null {
		const active = this.app.workspace.getActiveViewOfType(AsciidocView);
		if (active) this.lastView = active;
		if (this.lastView && !this.adocViews().includes(this.lastView)) this.lastView = null;
		return this.lastView ?? this.adocViews()[0] ?? null;
	}

	/** Include expansion for the preview and the export: resolved with Pro, notes without. */
	async expand(source: string, path: string): Promise<ExpandResult> {
		if (!isPro() || !this.settings.includes) return expandIncludes(source, path, {}, { resolve: false });
		// A file that fails to read counts as missing, so one bad include does not stop the render.
		const read = async (p: string): Promise<string | null> => {
			const f = this.app.vault.getFileByPath(p);
			return f ? this.app.vault.cachedRead(f).catch(() => null) : null;
		};
		return expandWithReader(source, path, read, { resolve: true, maxDepth: this.settings.depth });
	}

	takePendingAnchor(path: string): string | null {
		const id = this.pendingAnchors.get(path) ?? null;
		this.pendingAnchors.delete(path);
		return id;
	}

	/** Opens a vault file (trying the other AsciiDoc extension too) and scrolls to an anchor after it renders. */
	async openPath(path: string, fragment: string | null, newTab: boolean): Promise<void> {
		const alt = extOf(path) === 'adoc' ? withExt(path, 'asciidoc') : extOf(path) === 'asciidoc' ? withExt(path, 'adoc') : path;
		const file = this.app.vault.getFileByPath(path) ?? this.app.vault.getFileByPath(alt);
		if (!file) {
			new Notice(`No file at ${path}`);
			return;
		}
		const open = this.adocViews().find((v) => v.file === file);
		if (open && !newTab) {
			this.app.workspace.setActiveLeaf(open.leaf, { focus: true });
			if (fragment) open.scrollToId(fragment);
			return;
		}
		if (fragment) this.pendingAnchors.set(file.path, fragment);
		await this.app.workspace.getLeaf(newTab ? 'tab' : false).openFile(file);
	}

	private async createFile(folder: TFolder | null): Promise<void> {
		const dir = folder && !folder.isRoot() ? folder.path : '';
		let path = normalizePath(`${dir}/Untitled.adoc`);
		for (let i = 1; this.app.vault.getAbstractFileByPath(path) && i < 1000; i++) path = normalizePath(`${dir}/Untitled ${i}.adoc`);
		const file = await this.app.vault.create(path, NEW_FILE_TEXT);
		await this.app.workspace.getLeaf(false).openFile(file, { state: { mode: 'split' } });
	}

	async openLinksPanel(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(LINKS_VIEW_TYPE)[0];
		const leaf = existing ?? this.app.workspace.getRightLeaf(false);
		if (!leaf) return;
		if (!existing) await leaf.setViewState({ type: LINKS_VIEW_TYPE, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	refreshLinksSoon(): void {
		window.clearTimeout(this.linksTimer);
		this.linksTimer = window.setTimeout(() => {
			for (const leaf of this.app.workspace.getLeavesOfType(LINKS_VIEW_TYPE)) if (leaf.view instanceof LinksView) void leaf.view.refresh();
		}, 250);
	}

	/** Text of every AsciiDoc file in the vault (cached by modification time, bounded). */
	async adocDocs(): Promise<{ path: string; text: string }[]> {
		const files = this.app.vault.getFiles().filter((f) => isAdocPath(f.path)).slice(0, MAX_SCAN_FILES);
		const out: { path: string; text: string }[] = [];
		for (const f of files) {
			const hit = this.docCache.get(f.path);
			if (hit && hit.mtime === f.stat.mtime) out.push({ path: f.path, text: hit.text });
			else {
				const text = await this.app.vault.cachedRead(f);
				this.docCache.set(f.path, { mtime: f.stat.mtime, text });
				out.push({ path: f.path, text });
			}
		}
		return out;
	}

	/** Notes whose resolved links point to `path` (Markdown [[file.adoc]] links, from the metadata cache). */
	markdownLinksTo(path: string): string[] {
		const resolved = this.app.metadataCache.resolvedLinks;
		return Object.keys(resolved).filter((from) => from !== path && (resolved[from]?.[path] ?? 0) > 0).sort();
	}

	/**
	 * Export conversion: includes resolved, xrefs to other documents end in .html. The file and the clipboard leave
	 * the app, so the HTML is sanitized here, for both commands (Asciidoctor keeps passthrough HTML as it is).
	 */
	private async exportBody(view: AsciidocView): Promise<{ html: string; title: string; lang: string | null } | null> {
		const file = view.file;
		if (!file) return null;
		const expanded = await this.expand(view.data, file.path);
		const out = await convert({ text: expanded.text, path: file.path, target: 'export' });
		return { html: sanitizeHtml(out.html), title: out.title ?? file.basename, lang: out.lang };
	}

	async exportHtml(view: AsciidocView): Promise<string | null> {
		const file = view.file;
		const body = await this.exportBody(view);
		if (!file || !body) return null;
		const page = standalonePage({ title: body.title, body: body.html, css: this.settings.exportCss ? ASCIIDOCTOR_CSS : '', lang: body.lang ?? undefined });
		const path = await this.exportTarget(file.path);
		if (!path) {
			new Notice(`No free name for the export of ${file.path}.`);
			return null;
		}
		const existing = this.app.vault.getFileByPath(path);
		if (existing) await this.app.vault.modify(existing, page);
		else await this.app.vault.create(path, page);
		new Notice(`Exported to ${path}`);
		return path;
	}

	/** The first export name that is free or holds an earlier export. A file that the plugin did not write stays. */
	private async exportTarget(sourcePath: string): Promise<string | null> {
		for (let n = 0; n < 1000; n++) {
			const path = exportPath(sourcePath, n);
			const existing = this.app.vault.getAbstractFileByPath(path);
			if (!existing) return path;
			if (existing instanceof TFile && isOwnExport(await this.app.vault.read(existing))) return path;
		}
		return null;
	}

	async copyHtml(view: AsciidocView): Promise<void> {
		const body = await this.exportBody(view);
		if (!body) return;
		await navigator.clipboard.writeText(body.html);
		new Notice('HTML copied.');
	}
}
