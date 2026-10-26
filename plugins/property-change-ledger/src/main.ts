import { Modal, Notice, Plugin, TFile, normalizePath } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { Observer, SerialWriter, HEADER, csv, filterRecords, keyList, movedPath, readRecords, recordBlock, type Change, type Watch } from './ledger';
import { SPONSORS, bindPro, isPro, resetPro, proNotice } from './pro';
import { DEFAULT_SETTINGS, LedgerSettingTab, normalizeSettings, type LedgerSettings } from './settings';
import { HistoryModal, WatchModal } from './ui';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

export default class PropertyChangeLedgerPlugin extends Plugin {
	settings: LedgerSettings = normalizeSettings(DEFAULT_SETTINGS);
	pro: SponsorsManager | null = null;
	observer = new Observer(this.watch());
	readonly writer = new SerialWriter();
	ready = false;
	private tab: LedgerSettingTab | null = null;
	private stopped = false;
	modal: Modal | null = null;
	closeModal(): void { this.modal?.close(); this.modal = null; }
	openWatch(): void { this.closeModal(); this.modal = new WatchModal(this); this.modal.open(); }
	openHistory(): void { this.closeModal(); this.modal = new HistoryModal(this); this.modal.open(); }
	watch(): Watch { return { folder: this.settings.folder, keys: keyList(this.settings.keys), ledger: this.settings.ledger }; }
	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		this.pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		this.pro.init(); bindPro(this.pro);
		this.tab = new LedgerSettingTab(this.app, this);
		this.addSettingTab(this.tab);
		this.register(this.pro.onChange(() => this.tab?.update()));
		this.addCommand({ id: 'configure-watch', name: 'Set the folder and keys to watch', callback: () => this.openWatch() });
		this.addCommand({ id: 'recent-history', name: 'Show recent property changes', callback: () => this.openHistory() });
		this.addCommand({ id: 'open-ledger', name: 'Open the ledger', callback: () => { void this.openLedger(); } });
		this.addCommand({ id: 'retry-writes', name: 'Retry pending ledger writes', callback: () => { void this.flush(); } });
		this.registerEvent(this.app.metadataCache.on('changed', (file, _data, cache) => {
			if (!this.ready || this.stopped) return;
			const changes = this.observer.observe(file.path, (cache.frontmatter ?? {}), new Date().toISOString());
			if (changes.length) void this.append(changes);
		}));
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			const ledger = movedPath(this.settings.ledger, oldPath, file.path);
			const folder = this.settings.folder ? movedPath(this.settings.folder, oldPath, file.path) : null;
			if (ledger !== null || folder !== null) {
				Object.assign(this.settings, { ledger: ledger ?? this.settings.ledger, folder: folder ?? this.settings.folder });
				this.observer.watch = this.watch(); void this.saveSettings();
			}
			this.observer.rename(oldPath, file.path);
			const moved = file instanceof TFile ? [file] : this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(file.path + '/'));
			for (const f of moved) { const cache = this.app.metadataCache.getFileCache(f); if (cache) this.observer.seed(f.path, cache.frontmatter ?? {}); }
		}));
		this.registerEvent(this.app.vault.on('delete', file => this.observer.delete(file.path)));
		this.app.workspace.onLayoutReady(() => {
			if (this.stopped) return;
			this.setBaseline();
			void this.pro?.refresh();
			this.registerInterval(window.setInterval(() => { void this.pro?.refresh(); }, 6 * 60 * 60 * 1000));
		});
	}
	onunload(): void { this.stopped = true; this.ready = false; this.closeModal(); resetPro(); }
	async loadSettings(): Promise<void> { this.settings = normalizeSettings(await this.loadData() as unknown); }
	async saveSettings(): Promise<void> { await this.saveData(this.settings); this.tab?.update(); }
	setBaseline(): void {
		this.ready = false;
		this.observer = new Observer(this.watch());
		for (const file of this.app.vault.getMarkdownFiles()) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (cache) this.observer.observe(file.path, (cache.frontmatter ?? {}), '');
		}
		this.ready = true;
	}
	async applyWatch(watch: { folder: string; keys: string; ledger: string }): Promise<void> {
		const folder = watch.folder.trim() ? normalizePath(watch.folder.trim()) : '';
		const ledger = normalizePath(watch.ledger.trim());
		if (!ledger.endsWith('.md') || ledger.split('/').some(p => p === '..' || p === '.') || folder.split('/').some(p => p === '..' || p === '.')) throw new Error('Use a vault path and a Markdown ledger ending in .md.');
		if (!keyList(watch.keys).length) throw new Error('Set at least one exact property key.');
		const existingLedger = this.app.vault.getFileByPath(ledger);
		if (existingLedger && !(await this.app.vault.read(existingLedger)).startsWith('# Property change ledger\n')) throw new Error('Use a new ledger path. The selected path already has an unrelated note.');
		Object.assign(this.settings, { folder, keys: keyList(watch.keys).join(', '), ledger });
		this.setBaseline(); await this.saveSettings();
	}
	private async parents(path: string): Promise<void> {
		const parts = path.split('/'); parts.pop();
		let parent = '';
		for (const part of parts) { parent = parent ? parent + '/' + part : part; if (!this.app.vault.getAbstractFileByPath(parent)) await this.app.vault.createFolder(parent); }
	}
	async append(records: Change[]): Promise<void> {
		const path = this.settings.ledger;
		await this.writer.enqueue(async () => {
			const block = recordBlock(records);
			const existing = this.app.vault.getAbstractFileByPath(path);
			if (existing && !(existing instanceof TFile)) throw new Error('The ledger path is a folder.');
			if (existing instanceof TFile) await this.app.vault.process(existing, text => { if (!text.startsWith('# Property change ledger\n')) throw new Error('The ledger path has an unrelated note. Set a new ledger path.'); return text + (text.endsWith('\n') ? '' : '\n') + block; });
			else { await this.parents(path); await this.app.vault.create(path, HEADER + block); }
		});
		if (this.writer.error) new Notice('Ledger write failed. Pending records are in memory. Use retry pending ledger writes before you close Obsidian.');
	}
	async flush(): Promise<void> { await this.writer.flush(); if (this.writer.error) new Notice('Ledger write failed: ' + this.writer.error); }
	async history(): Promise<Change[]> {
		await this.flush();
		const file = this.app.vault.getFileByPath(this.settings.ledger);
		return file ? readRecords(await this.app.vault.read(file)) : [];
	}
	async openLedger(): Promise<void> {
		await this.flush(); const file = this.app.vault.getFileByPath(this.settings.ledger);
		if (file) await this.app.workspace.getLeaf('tab').openFile(file);
		else new Notice('No ledger yet. Change a watched property after the baseline is set.');
	}
	needsPro(): boolean { if (isPro()) return false; proNotice('This is a pro feature.'); return true; }
	async saveProfile(name: string): Promise<boolean> {
		if (this.needsPro()) return false;
		if (!name.trim()) throw new Error('Set a profile name.');
		const profile = { name: name.trim(), folder: this.settings.folder, keys: this.settings.keys, ledger: this.settings.ledger };
		this.settings.profiles = [...this.settings.profiles.filter(p => p.name !== profile.name), profile];
		await this.saveSettings(); return true;
	}
	async loadProfile(name: string): Promise<boolean> {
		if (this.needsPro()) return false;
		const profile = this.settings.profiles.find(p => p.name === name);
		if (!profile) return false;
		await this.applyWatch(profile); return true;
	}
	async exportCsv(note: string, key: string): Promise<string | null> {
		if (this.needsPro()) return null;
		const records = filterRecords(await this.history(), note, key);
		const base = normalizePath('Property history export ' + new Date().toISOString().replace(/[:.]/g, '-'));
		let path = base + '.csv';
		for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = `${base} ${n}.csv`;
		await this.app.vault.create(path, csv(records)); new Notice('CSV saved in the vault: ' + path); return path;
	}
}
