import { Notice, Plugin, TFile, type TAbstractFile } from 'obsidian';
import { createGitHubSponsors } from './license/github-obsidian';
import type { SponsorsManager } from './license/index';
import { deriveStats } from './count';
import { DEFAULT_SETTINGS, WordCountPropertySettingTab, normalizeSettings, type WordCountPropertySettings } from './settings';
import { bindPro, proNotice, SPONSORS } from './pro';
import { changeTracking, hasConflict, hasStats, isTracked, writeStats, type TrackingChange } from './tracking';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

const REFRESH_DELAY_MS = 5000;
const PRO_CHECK_MS = 6 * 60 * 60 * 1000;

export default class WordCountPropertyPlugin extends Plugin {
	settings: WordCountPropertySettings = { ...DEFAULT_SETTINGS };
	pro: SponsorsManager | null = null;
	private settingTab: WordCountPropertySettingTab | null = null;
	private readonly refreshTimers = new Map<string, number>();
	private readonly reportedErrors = new Set<string>();
	private unloaded = false;
	private readonly lastEdited = new Map<string, number>();
	private readonly refreshing = new Set<string>();
	private activeFile: TFile | null = null;

	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		this.unloaded = false;
		await this.loadSettings();
		if (this.unloaded) return;
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		this.register(pro.onChange(() => { if (!this.unloaded) this.settingTab?.update(); }));
		this.settingTab = new WordCountPropertySettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		this.addCommand({
			id: 'toggle-tracking',
			name: 'Toggle word count tracking for the current note',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== 'md') return false;
				if (!checking) void this.toggleTracking(file);
				return true;
			},
		});
		this.addCommand({
			id: 'reading-preview',
			name: 'Show local reading preview',
			editorCallback: (editor) => {
				if (!this.isPro()) { proNotice('Local reading preview needs Pro. Stored properties are free.'); return; }
				const stats = deriveStats(editor.getValue(), this.settings.countRenderedText ? 'rendered' : 'source', this.settings.includeCodeBlocks);
				new Notice(`Local preview: ${stats.wordCount} words, ${stats.readingTimeMinutes} min read. Stored properties use source counting.`);
			},
		});
		this.activeFile = this.app.workspace.getActiveFile();
		this.registerEvent(this.app.workspace.on('editor-change', (_editor, info) => {
			if (!info.file || this.unloaded) return;
			this.lastEdited.set(info.file.path, Date.now());
			this.scheduleRefresh(info.file);
		}));
		const onFileChange = () => {
			const previous = this.activeFile;
			this.activeFile = this.app.workspace.getActiveFile();
			if (previous && previous !== this.activeFile) {
				this.lastEdited.delete(previous.path);
				this.cancelPendingRefresh(previous.path);
				void this.refreshTrackedFile(previous);
			}
		};
		this.registerEvent(this.app.workspace.on('file-open', onFileChange));
		this.registerEvent(this.app.workspace.on('active-leaf-change', onFileChange));
		this.registerEvent(this.app.metadataCache.on('changed', (file) => this.scheduleRefresh(file)));
		this.app.workspace.onLayoutReady(() => {
			if (this.unloaded) return;
			void this.refreshTrackedNotes();
			void pro.refresh();
			this.registerInterval(window.setInterval(() => { if (!this.unloaded) void pro.refresh(); }, PRO_CHECK_MS));
		});
	}

	onunload(): void {
		this.unloaded = true;
		this.lastEdited.clear();
		for (const timer of this.refreshTimers.values()) window.clearTimeout(timer);
		this.refreshTimers.clear();
		bindPro(null);
	}

	isPro(): boolean {
		return this.pro?.isPro() ?? false;
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<WordCountPropertySettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async setRenderedText(enabled: boolean): Promise<void> {
		if (this.unloaded || (!this.isPro() && enabled)) return;
		this.settings.countRenderedText = enabled;
		await this.saveSettings();
		if (!this.unloaded) this.settingTab?.update();
	}

	async setCodeBlocks(enabled: boolean): Promise<void> {
		if (this.unloaded || !this.isPro() || !this.settings.countRenderedText) return;
		this.settings.includeCodeBlocks = enabled;
		await this.saveSettings();
		if (!this.unloaded) this.settingTab?.update();
	}

	async toggleTracking(file: TFile): Promise<TrackingChange | 'error'> {
		if (this.unloaded) return 'error';
		const cached = this.app.metadataCache.getFileCache(file)?.frontmatter;
		if (cached && !isTracked(cached) && hasConflict(cached)) { this.reportConflict(file); return 'conflict'; }
		this.cancelPendingRefresh(file.path);
		const outcome: { change: TrackingChange } = { change: 'already-disabled' };
		try {
			await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
				if (this.unloaded) return;
				outcome.change = changeTracking(frontmatter, !isTracked(frontmatter));
			});
		} catch {
			new Notice(`Word Count Property could not update ${file.name}. Check the note's frontmatter YAML.`);
			return 'error';
		}
		if (this.unloaded) return 'error';
		const change = outcome.change;
		if (change === 'conflict') {
			new Notice(`Word Count Property did not start tracking ${file.name} because it already has wordCount or readingTimeMinutes.`);
			return change;
		}
		if (change === 'enabled' || change === 'already-enabled') {
			await this.refreshTrackedFile(file, false);
			if (this.unloaded) return 'error';
			new Notice(`Word count tracking is on for ${file.basename}.`);
		} else if (change === 'disabled') {
			new Notice(`Word count tracking is off for ${file.basename}.`);
		}
		return change;
	}

	private scheduleRefresh(file: TAbstractFile): void {
		if (this.unloaded || !(file instanceof TFile) || file.extension !== 'md') return;
		const cached = this.app.metadataCache.getFileCache(file)?.frontmatter;
		if (!isTracked(cached)) return;
		this.cancelPendingRefresh(file.path);
		const timer = window.setTimeout(() => {
			this.refreshTimers.delete(file.path);
			void this.refreshTrackedFile(file);
		}, REFRESH_DELAY_MS);
		this.refreshTimers.set(file.path, timer);
	}

	private cancelPendingRefresh(path: string): void {
		const timer = this.refreshTimers.get(path);
		if (timer !== undefined) window.clearTimeout(timer);
		this.refreshTimers.delete(path);
	}

	private async refreshTrackedNotes(): Promise<void> {
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (this.unloaded) return;
			if (isTracked(this.app.metadataCache.getFileCache(file)?.frontmatter)) await this.refreshTrackedFile(file);
		}
	}

	private async refreshTrackedFile(file: TFile, checkCache = true): Promise<void> {
		if (this.unloaded || this.refreshing.has(file.path)) return;
		if (this.isEditing(file)) { this.scheduleRefresh(file); return; }
		if (checkCache && !isTracked(this.app.metadataCache.getFileCache(file)?.frontmatter)) return;
		this.refreshing.add(file.path);
		try {
			const text = await this.app.vault.read(file);
			if (this.unloaded || this.isEditing(file)) return;
			const stats = deriveStats(text, 'source');
			const cachedFrontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (cachedFrontmatter && hasConflict(cachedFrontmatter)) { this.reportConflict(file); return; }
			if (hasStats(cachedFrontmatter, stats)) return;
			await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
				if (this.unloaded || this.isEditing(file)) return;
				if (hasConflict(frontmatter)) { this.reportConflict(file); return; }
				writeStats(frontmatter, stats);
			});
			if (!this.unloaded) this.reportedErrors.delete(file.path);
		} catch {
			if (!this.unloaded && !this.reportedErrors.has(file.path)) {
				this.reportedErrors.add(file.path);
				new Notice(`Word Count Property could not update ${file.name}. Check the note's frontmatter YAML.`);
			}
		} finally {
			this.refreshing.delete(file.path);
		}
	}

	private isEditing(file: TFile): boolean {
		const edited = this.lastEdited.get(file.path);
		return edited !== undefined && Date.now() - edited < REFRESH_DELAY_MS;
	}

	private reportConflict(file: TFile): void {
		if (this.unloaded || this.reportedErrors.has(file.path)) return;
		this.reportedErrors.add(file.path);
		new Notice(`Word Count Property skipped ${file.name}: existing count values are not owned by this plugin. Move them to other properties before tracking.`);
	}
}
