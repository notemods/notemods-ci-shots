import { Plugin, Notice, type Modal, type TFile } from 'obsidian';
import { createGitHubSponsors } from './license/github-obsidian';
import type { SponsorsManager } from './license/index';
import { bindPro, isPro, proNotice, SPONSORS, UNDO_LEAD } from './pro';
import { EditView, VIEW_ID } from './view';
import { BulkSettingsTab, normalizeSettings, savedAction, type BulkSettings } from './settings';
import { applyChanges, type Action, type Change, type Stamp, type Store } from './edit';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

export interface Batch { property: string; changes: Change[] }
export default class BasesMultiEditPlugin extends Plugin {
	settings: BulkSettings = { actions: [] };
	pro: SponsorsManager | null = null;
	history: Batch[] = [];
	busy = false;
	private stopped = false;
	readonly dialogs = new Set<Modal>();
	readonly generation = `${Date.now()}-${Math.random()}`;
	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		this.stopped = false;
		this.settings = normalizeSettings(await this.loadData());
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init(); this.pro = pro; bindPro(pro);
		this.registerBasesView(VIEW_ID, { name: 'Multi-row edit', icon: 'list-checks', factory: (controller, container) => new EditView(controller, container, this) });
		const tab = new BulkSettingsTab(this.app, this);
		this.addSettingTab(tab);
		this.register(pro.onChange(() => tab.update()));
		this.addCommand({ id: 'undo-batch', name: 'Undo the last bulk edit', checkCallback: checking => {
			if (!this.history.length || this.busy) return false;
			if (!checking) void this.undo();
			return true;
		} });
		this.app.workspace.onLayoutReady(() => {
			void this.reopenStaleViews();
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
		});
	}
	onunload(): void { this.stopped = true; for (const dialog of this.dialogs) dialog.close(); this.dialogs.clear(); bindPro(null); this.history = []; }
	/** Refresh Bases tabs that still hold the previous plugin instance after an update. */
	async reopenStaleViews(): Promise<void> {
		for (const leaf of this.app.workspace.getLeavesOfType('bases')) {
			const root = leaf.view.containerEl.querySelector<HTMLElement>('.bme-table-view');
			if (!root || root.dataset.bmeGeneration === this.generation) continue;
			const state = leaf.getViewState();
			await leaf.setViewState({ type: 'empty' });
			await leaf.setViewState(state);
		}
	}
	/** File state from the vault index, read before the preview and again before each write. */
	stamp(path: string): Stamp | null {
		const file = this.app.vault.getFileByPath(path);
		return file ? { mtime: file.stat.mtime, size: file.stat.size } : null;
	}
	store(): Store { return { stamp: path => this.stamp(path), update: async (path, callback) => {
		if (this.stopped) throw new Error('The plugin was unloaded.');
		const file = this.app.vault.getFileByPath(path);
		if (!file || file.extension !== 'md') throw new Error('Markdown note no longer exists');
		await this.app.fileManager.processFrontMatter(file, callback);
	} }; }
	async apply(action: Action, changes: Change[]): Promise<string> {
		if (this.busy) throw new Error('Another bulk edit is running.');
		this.busy = true;
		try {
			const result = await applyChanges(this.store(), changes, action.property);
			if (result.completed.length) {
				this.history.push({ property: action.property, changes: result.completed });
				const dropped = !isPro() && this.history.length > 1;
				this.history = this.history.slice(isPro() ? -20 : -1);
				// Free keeps one batch. Tell the user that the earlier batch can no longer be undone.
				if (dropped) proNotice(UNDO_LEAD);
			}
			// Free keeps one batch: a new apply for the skipped notes replaces it.
			const hint = result.skipped.length && !isPro() ? '\nUndo the batch first if you need it.' : '';
			return `${result.completed.length} ${result.completed.length === 1 ? 'note' : 'notes'} changed. ${result.skipped.length} skipped.\n${result.skipped.join('\n')}${hint}`;
		} finally { this.busy = false; }
	}
	async undo(): Promise<string> {
		if (this.busy || !this.history.length) return 'No batch to undo.';
		this.busy = true;
		try {
			const batch = this.history[this.history.length - 1]!;
			const result = await applyChanges(this.store(), batch.changes, batch.property, true);
			const done = new Set(result.completed);
			batch.changes = batch.changes.filter(c => !done.has(c));
			if (!batch.changes.length) this.history.pop();
			const message = `${result.completed.length} ${result.completed.length === 1 ? 'note' : 'notes'} restored. ${result.skipped.length} skipped.\n${result.skipped.join('\n')}`;
			new Notice(message); return message;
		} finally { this.busy = false; }
	}
	async saveAction(action: Action): Promise<void> {
		if (!isPro()) throw new Error('Saved actions require Pro.');
		const saved = savedAction(action), key = JSON.stringify(saved);
		this.settings.actions = [...this.settings.actions.filter(a => JSON.stringify(a) !== key), saved].slice(-50);
		await this.saveData(this.settings);
	}
	async openNote(file: TFile): Promise<void> { await this.app.workspace.openLinkText(file.path, '', false); }
}
