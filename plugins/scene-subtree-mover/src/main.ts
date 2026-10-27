import { Notice, Plugin, normalizePath, type TFile } from 'obsidian';
import { createGitHubSponsors } from './license/github-obsidian';
import type { SponsorsManager } from './license/index';
import { checkedUpdate, readIndex } from './index-file';
import { SPONSORS, bindPro, isPro, resetPro, proText } from './pro';
import { DEFAULT_SETTINGS, normalizeSettings, SceneSubtreeMoverSettingTab, type SavedOrder, type SceneSubtreeMoverSettings } from './settings';
import { checkRestore, readTree, sameOrder, writeTree, type SceneNode } from './tree';
import { SceneMoverModal } from './modal';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

export interface OrderPreview {
	file: TFile;
	path: string;
	source: string;
	before: SceneNode[];
	after: SceneNode[];
	proAction: boolean;
}
export interface ApplyResult {
	changed: boolean;
	backupPath: string | null;
}

export default class SceneSubtreeMoverPlugin extends Plugin {
	settings: SceneSubtreeMoverSettings = { ...DEFAULT_SETTINGS, orders: [] };
	pro: SponsorsManager | null = null;
	private settingTab: SceneSubtreeMoverSettingTab | null = null;
	private readonly busyPaths = new Set<string>();
	private readonly modals = new Set<SceneMoverModal>();
	private stopped = false;
	private saveQueue: Promise<void> = Promise.resolve();

	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		if (this.stopped) return;
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		this.settingTab = new SceneSubtreeMoverSettingTab(this.app, this);
		this.register(pro.onChange(() => this.settingTab?.update()));
		this.addSettingTab(this.settingTab);
		this.addCommand({
			id: 'move-chapter',
			name: 'Move a chapter with its scenes',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== 'md') return false;
				if (!checking) void this.openMover(file);
				return true;
			},
		});
		this.app.workspace.onLayoutReady(() => {
			if (this.stopped) return;
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
		});
	}

	onunload(): void {
		this.stopped = true;
		for (const modal of [...this.modals]) modal.close();
		resetPro();
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
	}

	async readPreview(file: TFile): Promise<OrderPreview> {
		const path = file.path;
		const source = await this.app.vault.read(file);
		const { tree } = readIndex(source);
		if (file.path !== path) throw new Error('Conflict: the index path changed. Reopen the mover.');
		return { file, path, source, before: tree, after: readTree(writeTree(tree)), proAction: false };
	}

	async openMover(file: TFile): Promise<void> {
		try {
			const preview = await this.readPreview(file);
			if (this.stopped) return;
			const modal = new SceneMoverModal(this.app, this, preview, () => this.modals.delete(modal));
			this.modals.add(modal);
			modal.open();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : String(error));
		}
	}

	requirePro(): void {
		if (!isPro()) throw new Error(proText('This action needs Pro. A single move, preview and backup are free.'));
	}

	private checkPath(preview: OrderPreview): void {
		if (this.stopped) throw new Error('The plugin was unloaded. Reopen the mover after you enable it.');
		if (preview.file.path !== preview.path || this.app.vault.getFileByPath(preview.path) !== preview.file) throw new Error('Conflict: the index path changed. Reopen the mover.');
	}

	/** A failed backup stops the operation before Vault.process is called. */
	async applyPreview(preview: OrderPreview): Promise<ApplyResult> {
		if (preview.proAction) this.requirePro();
		this.checkPath(preview);
		if (sameOrder(preview.before, preview.after)) return { changed: false, backupPath: null };
		if (this.busyPaths.has(preview.path)) throw new Error('An update for this index is in progress.');
		this.busyPaths.add(preview.path);
		let backupPath: string | null = null;
		try {
			const replacement = checkedUpdate(preview.source, preview.source, preview.after);
			if (await this.app.vault.read(preview.file) !== preview.source) throw new Error('Conflict: the index changed after preview. Reopen the mover.');
			this.checkPath(preview);
			const stamp = new Date().toISOString().replace(/[:.]/g, '-');
			backupPath = normalizePath(`${preview.path.replace(/\.md$/i, '')}.scene-backup-${stamp}-${crypto.randomUUID().slice(0, 8)}.md.bak`);
			await this.app.vault.create(backupPath, preview.source);
			this.checkPath(preview);
			if (preview.proAction) this.requirePro();
			await this.app.vault.process(preview.file, (current) => {
				this.checkPath(preview);
				if (preview.proAction) this.requirePro();
				if (current !== preview.source) throw new Error('Conflict: the index changed after preview. Reopen the mover.');
				return replacement;
			});
			return { changed: true, backupPath };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(backupPath && this.app.vault.getFileByPath(backupPath) ? `${message} Backup: ${backupPath}` : message);
		} finally {
			this.busyPaths.delete(preview.path);
		}
	}

	saveOrder(name: string, preview: OrderPreview): Promise<void> {
		const pending = this.saveQueue.then(() => this.storeOrder(name, preview));
		this.saveQueue = pending.catch(() => undefined);
		return pending;
	}

	private async storeOrder(name: string, preview: OrderPreview): Promise<void> {
		this.requirePro();
		const clean = name.trim();
		if (!clean || clean.length > 120) throw new Error('Use an order name from 1 to 120 characters.');
		this.checkPath(preview);
		if (await this.app.vault.read(preview.file) !== preview.source) throw new Error('Conflict: the index changed after preview. Reopen the mover.');
		this.checkPath(preview);
		this.requirePro();
		readTree(writeTree(preview.after));
		const orders = this.settings.orders.filter((item) => item.indexPath !== preview.path || item.name !== clean);
		orders.push({ name: clean, indexPath: preview.path, scenes: writeTree(preview.after), savedAt: new Date().toISOString() });
		await this.saveData({ orders });
		this.settings = { orders };
		this.settingTab?.update();
	}

	restoreOrder(order: SavedOrder, preview: OrderPreview): SceneNode[] {
		this.requirePro();
		if (order.indexPath !== preview.path) throw new Error('Select an order for this index path.');
		const tree = readTree(order.scenes);
		checkRestore(preview.before, tree);
		return tree;
	}
}
