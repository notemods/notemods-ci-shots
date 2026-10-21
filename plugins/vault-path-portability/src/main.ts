import { FileSystemAdapter, ItemView, Modal, Notice, Plugin, TFile, TFolder, normalizePath, type WorkspaceLeaf } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { SPONSORS } from './pro';
import { DEFAULT_SETTINGS, normalizeSettings, VaultPathPortabilitySettingTab } from './settings';
import { fold, lengthScope, markdownReport, RULES, scanPaths, suggestPath, type Finding, type Rule } from './scan';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

const VIEW = 'vault-path-portability-report';
export default class VaultPathPortabilityPlugin extends Plugin {
	settings = { ...DEFAULT_SETTINGS };
	pro: SponsorsManager | null = null;
	findings: Finding[] = [];
	private status: HTMLElement | null = null;
	private timer: number | null = null;
	private stopped = false;
	private settingTab: VaultPathPortabilitySettingTab | null = null;
	private renaming = false;
	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		this.settings = normalizeSettings(await this.loadData());
		this.pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		this.pro.init();
		this.register(this.pro.onChange(() => { this.updateAutoScan(); this.settingTab?.update(); this.renderReports(); }));
		this.settingTab = new VaultPathPortabilitySettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		this.registerView(VIEW, leaf => new PortabilityView(leaf, this));
		this.addCommand({ id: 'scan-vault-paths', name: 'Scan vault paths', callback: () => { void this.showReport().catch(() => new Notice('Could not open the path report.')); } });
		this.addCommand({ id: 'copy-path-report', name: 'Copy path report as Markdown', callback: () => { void this.copyReport(); } });
		this.addCommand({ id: 'export-path-report', name: 'Export path report to a note (pro)', callback: () => { void this.exportReport(); } });
		this.app.workspace.onLayoutReady(() => {
			if (this.stopped) return;
			this.registerEvent(this.app.vault.on('create', () => this.queueScan()));
			this.registerEvent(this.app.vault.on('rename', () => this.queueScan()));
			this.registerEvent(this.app.vault.on('delete', () => this.queueScan()));
			this.updateAutoScan();
			void this.pro?.refresh();
			this.registerInterval(window.setInterval(() => { void this.pro?.refresh(); }, 6 * 60 * 60 * 1000));
		});
	}
	onunload(): void {
		this.stopped = true;
		if (this.timer !== null) window.clearTimeout(this.timer);
	}
	paths(): string[] { return this.app.vault.getAllLoadedFiles().map(f => f.path).filter(p => p !== '/'); }
	basePath(): string | undefined {
		return this.app.vault.adapter instanceof FileSystemAdapter ? this.app.vault.adapter.getBasePath() : undefined;
	}
	scan(): Finding[] {
		this.findings = scanPaths(this.paths(), this.basePath());
		this.status?.setText(`Path issues: ${this.findings.length}`);
		return this.findings;
	}
	updateAutoScan(): void {
		if (this.stopped) return;
		if (this.settings.autoScan && this.pro?.isPro()) {
			this.status ??= this.addStatusBarItem();
			this.scan();
		} else {
			this.status?.remove(); this.status = null;
			if (this.timer !== null) window.clearTimeout(this.timer);
			this.timer = null;
		}
	}
	private queueScan(): void {
		if (this.stopped || !this.settings.autoScan || !this.pro?.isPro()) return;
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => { this.timer = null; if (!this.stopped) { this.scan(); this.renderReports(); } }, 300);
	}
	async showReport(): Promise<void> {
		this.scan();
		const leaf = this.app.workspace.getLeavesOfType(VIEW)[0] ?? this.app.workspace.getLeaf('tab');
		await leaf.setViewState({ type: VIEW, active: true });
		await this.app.workspace.revealLeaf(leaf);
		this.renderReports();
	}
	renderReports(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) if (leaf.view instanceof PortabilityView) leaf.view.render();
	}
	async copyReport(): Promise<void> {
		try { await navigator.clipboard.writeText(markdownReport(this.scan(), this.basePath())); new Notice('Path report copied.'); }
		catch { new Notice('Could not copy the report. Check clipboard access.'); }
	}
	async exportReport(): Promise<void> {
		if (!this.pro?.isPro()) { new Notice('Report notes are a pro feature. You can copy the full report for free.'); return; }
		try {
			const report = markdownReport(this.scan(), this.basePath());
			const occupied = new Set(this.paths().map(fold));
			let i = 1;
			let path = normalizePath('Vault path report.md');
			while (occupied.has(fold(path)) || this.app.vault.getAbstractFileByPath(path) || await this.app.vault.adapter.exists(path)) path = normalizePath(`Vault path report ${++i}.md`);
			const file = await this.app.vault.create(path, report);
			await this.app.workspace.getLeaf('tab').openFile(file);
		} catch { new Notice('Could not create the report note. No existing note was overwritten.'); }
	}
	reviewRename(path: string, target: string): void {
		new RenameReviewModal(this, path, target).open();
	}
	async rename(path: string, target: string): Promise<void> {
		if (this.renaming || !this.pro?.isPro()) return;
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!file || suggestPath(path, this.paths(), file instanceof TFolder, this.basePath()) !== target || normalizePath(target) !== target) {
			new Notice('This suggestion changed. Scan again before renaming.'); return;
		}
		this.renaming = true;
		try {
			if (await this.app.vault.adapter.exists(target)) {
				new Notice('The suggested path exists on disk. Scan again or choose another name.'); return;
			}
			await this.app.fileManager.renameFile(file, target);
			new Notice(`Renamed to ${target}.`);
		} catch { new Notice('Rename failed. Check permissions and scan again.'); }
		finally { this.renaming = false; this.scan(); this.renderReports(); }
	}
}

export class PortabilityView extends ItemView {
	constructor(leaf: WorkspaceLeaf, private plugin: VaultPathPortabilityPlugin) { super(leaf); }
	getViewType(): string { return VIEW; }
	getDisplayText(): string { return 'Vault path portability'; }
	getIcon(): string { return 'folder-check'; }
	protected async onOpen(): Promise<void> { this.plugin.scan(); this.render(); }
	protected async onClose(): Promise<void> { this.contentEl.empty(); }
	render(): void {
		const el = this.contentEl;
		el.empty(); el.addClass('vpp-report');
		el.createEl('h2', { text: 'Vault path portability' });
		el.createEl('p', { text: `${this.plugin.findings.length} findings · ${this.plugin.paths().length} indexed paths. Scanning changes no files.` });
		el.createEl('p', { cls: 'vpp-hint', text: `${lengthScope(this.plugin.basePath())} Hidden and unindexed files, including NFC/NFD collisions, are outside this scan. Android restrictions depend on the storage provider.` });
		const toolbar = el.createDiv({ cls: 'vpp-toolbar' });
		this.button(toolbar, 'Scan again', () => { this.plugin.scan(); this.plugin.renderReports(); });
		this.button(toolbar, 'Copy Markdown', () => this.plugin.copyReport());
		if (this.plugin.pro?.isPro()) this.button(toolbar, 'Export to note', () => this.plugin.exportReport());
		if (!this.plugin.findings.length) el.createEl('p', { text: 'No indexed path issues found. This does not guarantee compatibility with every file system or sync service.' });
		const paths = this.plugin.paths();
		for (const rule of Object.keys(RULES) as Rule[]) {
			const group = this.plugin.findings.filter(f => f.rule === rule);
			if (!group.length) continue;
			el.createEl('h3', { text: `${RULES[rule]} (${group.length})` });
			for (const finding of group) {
				const row = el.createDiv({ cls: 'vpp-finding' });
				for (const path of finding.paths) {
					const item = row.createDiv({ cls: 'vpp-path' });
					item.createEl('code', { text: path });
					const file = this.app.vault.getAbstractFileByPath(path);
					if (file instanceof TFile) this.button(item, 'Open file', () => this.app.workspace.getLeaf('tab').openFile(file));
					const target = suggestPath(path, paths, file instanceof TFolder, this.plugin.basePath());
					if (target) {
						item.createEl('small', { text: `Suggested path: ${target}` });
						this.button(item, 'Review rename', () => this.plugin.reviewRename(path, target));
					} else item.createEl('small', { text: 'Fix the parent folder first or choose a shorter path manually.' });
				}
			}
		}
		if (this.plugin.pro?.isPro()) el.createEl('p', { cls: 'vpp-hint', text: 'Each rename button changes only that file or folder. Link updates follow the automatic internal link update setting. Back up before reorganizing folders.' });
	}
	private button(parent: HTMLElement, text: string, action: () => void | Promise<unknown>): void {
		parent.createEl('button', { text }).addEventListener('click', () => { void Promise.resolve().then(action).catch(() => new Notice('The action failed. Scan again and retry.')); });
	}
}

export class RenameReviewModal extends Modal {
	constructor(private plugin: VaultPathPortabilityPlugin, private path: string, private target: string) { super(plugin.app); }
	onOpen(): void {
		this.setTitle('Review rename');
		this.contentEl.addClass('vpp-rename-review');
		this.contentEl.createEl('p', { text: 'Current path' });
		this.contentEl.createEl('code', { text: this.path });
		this.contentEl.createEl('p', { text: 'Suggested path' });
		this.contentEl.createEl('code', { text: this.target });
		this.contentEl.createEl('p', { text: 'Link updates follow the automatic internal link update setting in Obsidian. Back up before changing folder names.' });
		if (this.plugin.pro?.isPro()) {
			const apply = this.contentEl.createEl('button', { text: 'Rename this path', cls: 'mod-cta' });
			apply.addEventListener('click', () => { apply.disabled = true; void this.plugin.rename(this.path, this.target).finally(() => this.close()); });
		} else {
			this.contentEl.createEl('button', { text: 'Rename this path' }).disabled = true;
			this.contentEl.createEl('p', { text: 'Applying a suggestion needs pro. You can rename manually with the file explorer.' });
		}
		this.contentEl.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
	}
	onClose(): void { this.contentEl.empty(); }
}
