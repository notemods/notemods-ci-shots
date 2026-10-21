import { Notice, Plugin, TFile, debounce, normalizePath } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { SPONSORS, PRO_LABEL, SYNC_LABEL, bindPro, isPro, onProChange, resetPro } from './pro';
import { DEFAULT_SETTINGS, SyncChurnWatchSettingTab, normalizeSettings, type SyncChurnWatchSettings } from './settings';
import { Watch, POLL_MS, exclusionFolders, markdown, type Row, type Session } from './watch';
import { ChurnView, VIEW_ID } from './view';
import { savedSessions } from './storage';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

export default class SyncChurnWatchPlugin extends Plugin {
	settings: SyncChurnWatchSettings = { ...DEFAULT_SETTINGS };
	pro: SponsorsManager | null = null;
	watch!: Watch;
	history: Session[] = [];
	private timer: number | null = null;
	private stopping: Promise<void> | null = null;
	private unloaded = false;
	private notices = new Set<string>();
	private status: HTMLElement | null = null;
	private settingTab: SyncChurnWatchSettingTab | null = null;
	// A bulk edit sends one modify event per file. Redraw the view at most two times each second.
	private queueRedraw = debounce(() => { if (!this.unloaded) this.redraw(); }, 500, false);

	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		const config = normalizePath(this.app.vault.configDir);
		const own = normalizePath(this.manifest.dir ?? `${config}/plugins/${this.manifest.id}`);
		this.watch = new Watch(this.app.vault.adapter, config, own, () => { this.queueRedraw(); }, (r, now) => this.alert(r, now));
		this.watch.session = this.lastSession;
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init(); this.pro = pro; bindPro(pro);
		this.settingTab = new SyncChurnWatchSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		this.register(onProChange(() => { this.settingTab?.update(); this.redraw(); }));
		this.registerView(VIEW_ID, (leaf) => new ChurnView(leaf, this));
		this.status = this.addStatusBarItem();
		this.status.addClass('sync-churn-status');
		this.registerDomEvent(this.status, 'click', () => { void (this.watch.active ? this.stopSession() : this.startSession()); });
		this.addCommand({ id: 'start-session', name: 'Start a watch session', callback: () => { void this.startSession(); } });
		this.addCommand({ id: 'stop-session', name: 'Stop the watch session', callback: () => { void this.stopSession(); } });
		this.addCommand({ id: 'open-watch', name: 'Open the watch view', callback: () => { void this.openView(); } });
		this.addCommand({ id: 'copy-results', name: 'Copy results as Markdown', callback: () => { void this.copyResults(); } });
		this.addCommand({ id: 'copy-exclusions', name: `Copy folders to review for ${SYNC_LABEL} exclusions (${PRO_LABEL})`, callback: () => { void this.copyExclusions(); } });
		this.registerEvent(this.app.vault.on('modify', (file) => {
			if (file instanceof TFile) this.watch.observe(file.path, file.path, 'vault', file.stat.size);
		}));
		this.app.workspace.onLayoutReady(() => {
			if (this.unloaded) return;
			void pro.refresh();
			this.registerInterval(window.setInterval(() => { void pro.refresh(); }, 6 * 60 * 60 * 1000));
		});
		this.redraw();
	}
	private lastSession: Session | null = null;
	async loadSettings(): Promise<void> {
		const saved: unknown = await this.loadData();
		const data = saved && typeof saved === 'object' ? saved as Record<string, unknown> : {};
		this.settings = normalizeSettings(data.settings);
		this.history = savedSessions(data.history);
		this.lastSession = savedSessions([data.lastSession])[0] ?? null;
	}
	async startSession(): Promise<void> {
		if (this.unloaded || this.watch.active || this.watch.starting) return;
		await this.stopping;
		if (this.unloaded) return;
		this.notices.clear();
		await this.watch.start();
		if (this.unloaded || !this.watch.active || this.timer !== null) return;
		this.timer = window.setInterval(() => { void this.watch.poll(); }, POLL_MS);
		this.registerInterval(this.timer);
		this.redraw();
	}
	stopSession(): Promise<void> {
		if (this.stopping) return this.stopping;
		this.clearPoll();
		const session = this.watch.stop();
		if (!session) return Promise.resolve();
		if (isPro()) this.history = [...this.history, session].slice(-30);
		this.lastSession = session;
		this.stopping = this.saveData({ settings: this.settings, lastSession: session, history: this.history })
			.catch(() => { new Notice('The session could not be saved. Results remain in this view.'); })
			.finally(() => { this.stopping = null; this.redraw(); });
		return this.stopping;
	}
	private clearPoll(): void { if (this.timer !== null) window.clearInterval(this.timer); this.timer = null; }
	onunload(): void { this.unloaded = true; this.queueRedraw.cancel(); this.clearPoll(); this.watch?.dispose(); resetPro(); }
	redraw(): void {
		this.status?.setText(this.watch?.active ? 'Churn watch: on · click to stop' : 'Churn watch: off · click to start');
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_ID)) if (leaf.view instanceof ChurnView) leaf.view.render();
	}
	async openView(): Promise<void> {
		const leaf = this.app.workspace.getLeavesOfType(VIEW_ID)[0] ?? this.app.workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: VIEW_ID, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}
	async copyResults(): Promise<void> { await this.copyText(markdown(this.watch.session, Date.now()), 'Results copied as Markdown.'); }
	async copyExclusions(): Promise<void> {
		if (!isPro()) { new Notice(`Folder suggestions need ${PRO_LABEL}. Core counts and Markdown copy are free.`); return; }
		const folders = exclusionFolders(this.watch.session);
		if (!folders.length) { new Notice('No folder suggestions from this session.'); return; }
		await this.copyText(folders.join('\n'), 'Folders copied. Review the list before you change Sync.');
	}
	private async copyText(text: string, message: string): Promise<void> {
		try { await navigator.clipboard.writeText(text); new Notice(message); }
		catch { new Notice('Clipboard access failed. Use the table in the watch view.'); }
	}
	private alert(row: Row, now: number): void {
		const session = this.watch.session;
		if (!isPro() || !this.settings.alerts || !session || this.notices.has(row.path)) return;
		const writesPerHour = row.writes * 3_600_000 / Math.max(60_000, now - session.started);
		if (writesPerHour > this.settings.threshold) {
			this.notices.add(row.path);
			new Notice(`${row.name}: at least ${row.writes} writes; ${Math.round(writesPerHour)} writes/h. Bytes are estimates.`);
		}
	}
}
