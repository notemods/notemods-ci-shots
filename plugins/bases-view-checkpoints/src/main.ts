import { FuzzySuggestModal, Modal, Notice, Plugin, Setting, TFile, type App } from 'obsidian';
import { compareCheckpoint, restoreCheckpoint, saveCheckpoint, viewNames, type Checkpoint } from './basefile';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { bindPro, isPro, PRO_UI, SPONSORS } from './pro';
import { BasesViewCheckpointsSettingTab, normalizeSettings, type CheckpointsSettings } from './settings';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

interface CheckpointData {
	free: Record<string, Checkpoint>;
	named: Record<string, Checkpoint>;
	undo: { path: string; before: string; after: string } | null;
}

const freeKey = (path: string, view: string) => JSON.stringify([path, view]);
const namedKey = (cp: Checkpoint) => JSON.stringify([cp.path, cp.viewName, cp.label]);
const isBase = (f: unknown): f is TFile => f instanceof TFile && f.extension === 'base';
const CONFLICT = 'The file changed after the preview. Restore refused. Open a new preview.';
const UNDO_CONFLICT = 'The file changed after the restore, so the undo was refused.';

export default class BasesViewCheckpointsPlugin extends Plugin {
	settings: CheckpointsSettings = normalizeSettings(null);
	data: CheckpointData = { free: {}, named: {}, undo: null };
	pro: SponsorsManager | null = null;

	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		const settingTab = new BasesViewCheckpointsSettingTab(this.app, this);
		this.register(pro.onChange(() => settingTab.update()));
		this.addSettingTab(settingTab);
		this.addCommand({ id: 'save-checkpoint', name: 'Save view checkpoint', callback: () => this.pickSave(false) });
		this.addCommand({ id: 'restore-checkpoint', name: 'Restore view checkpoint', callback: () => this.pickCheckpoint((cp) => this.run(() => this.restore(cp))) });
		this.addCommand({ id: 'undo-checkpoint-restore', name: 'Undo last checkpoint restore', callback: () => this.run(() => this.undo()) });
		this.addCommand({ id: 'save-named', name: 'Save named checkpoint', checkCallback: (checking) => {
			if (!isPro()) return false;
			if (!checking) this.pickSave(true);
			return true;
		} });
		this.addCommand({ id: 'compare-checkpoint', name: 'Compare checkpoint with current view', checkCallback: (checking) => {
			if (!isPro()) return false;
			if (!checking) this.pickCheckpoint((cp) => this.run(() => this.compare(cp)));
			return true;
		} });
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			if (isBase(file)) this.run(() => this.rekey(oldPath, file.path));
		}));
		this.app.workspace.onLayoutReady(() => {
			this.run(() => pro.refresh());
			this.registerInterval(window.setInterval(() => this.run(() => pro.refresh()), 6 * 60 * 60 * 1000));
		});
	}

	onunload(): void {
		bindPro(null);
		this.pro = null;
	}

	private run(action: () => Promise<unknown>): void {
		void action().catch((error: unknown) => new Notice(`Bases view checkpoints: ${error instanceof Error ? error.message : String(error)}`));
	}

	async loadSettings(): Promise<void> {
		const saved = ((await this.loadData()) ?? {}) as Partial<CheckpointsSettings> & Partial<CheckpointData>;
		this.settings = normalizeSettings(saved);
		this.data = {
			free: validMap(saved.free, false), named: validMap(saved.named, true),
			undo: saved.undo && typeof saved.undo.path === 'string' && typeof saved.undo.before === 'string' && typeof saved.undo.after === 'string' ? saved.undo : null,
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData({ ...this.settings, ...this.data });
	}

	needPro(): boolean {
		if (isPro()) return true;
		new Notice(`Pro feature. ${PRO_UI.priceText} See the plugin settings.`);
		return false;
	}

	private async rekey(oldPath: string, newPath: string): Promise<void> {
		for (const [key, cp] of Object.entries(this.data.free)) if (cp.path === oldPath) {
			delete this.data.free[key];
			this.data.free[freeKey(newPath, cp.viewName)] = { ...cp, path: newPath };
		}
		for (const [key, cp] of Object.entries(this.data.named)) if (cp.path === oldPath) {
			delete this.data.named[key];
			const next = { ...cp, path: newPath };
			this.data.named[namedKey(next)] = next;
		}
		if (this.data.undo?.path === oldPath) this.data.undo.path = newPath;
		await this.saveSettings();
	}

	private pickSave(named: boolean): void {
		new ChoiceModal(this.app, this.app.vault.getFiles().filter(isBase), (f) => f.path, (file) => this.run(async () => {
			const names = viewNames(await this.app.vault.read(file));
			if (names === null) throw new Error('The file has invalid YAML or two views with the same name.');
			if (!names.length) throw new Error('The file has no views.');
			new ChoiceModal(this.app, names, (name) => name, (view) => {
				if (named) new NameModal(this.app, (label) => this.run(() => this.save(file, view, label))).open();
				else this.run(() => this.save(file, view));
			}, 'Select a view').open();
		}), 'Select a base file').open();
	}

	private pickCheckpoint(cb: (cp: Checkpoint) => void): void {
		const checkpoints = [...Object.values(this.data.free), ...(isPro() ? Object.values(this.data.named) : [])];
		if (!checkpoints.length) { new Notice('No checkpoint saved yet.'); return; }
		new ChoiceModal(this.app, checkpoints, (cp) => `${cp.label ?? 'Free checkpoint'} — ${cp.viewName} — ${cp.path}`, cb, 'Select a checkpoint').open();
	}

	async save(file: TFile, viewName: string, label = ''): Promise<void> {
		if (label && !this.needPro()) return;
		const result = saveCheckpoint(await this.app.vault.read(file), file.path, viewName);
		if (!result.ok) throw new Error(result.reason);
		if (label) {
			const cp = { ...result.checkpoint, label };
			this.data.named[namedKey(cp)] = cp;
		} else this.data.free[freeKey(file.path, viewName)] = result.checkpoint;
		this.settings.empty = false;
		await this.saveSettings();
		new Notice(`Saved checkpoint for view "${viewName}".`);
	}

	async restore(cp: Checkpoint): Promise<void> {
		if (cp.label && !this.needPro()) return;
		const file = this.app.vault.getFileByPath(cp.path);
		if (!file) throw new Error(`${cp.path} is missing.`);
		const source = await this.app.vault.read(file);
		const result = restoreCheckpoint(source, cp);
		if (!result.ok) throw new Error(result.reason);
		new RestorePreviewModal(this.app, cp, result.changes, () => this.run(async () => {
			if (cp.label && !this.needPro()) return;
			await this.applyRestore(file, cp, source);
			new Notice(`Restored view "${cp.viewName}".`);
		})).open();
	}

	/** The preview and direct test path use this same atomic write. */
	async applyRestore(file: TFile, cp: Checkpoint, expected: string): Promise<void> {
		if (cp.label && !this.needPro()) return;
		let before = '';
		const after = await this.app.vault.process(file, (current) => {
			if (current !== expected) throw new Error(CONFLICT);
			const result = restoreCheckpoint(current, cp);
			if (!result.ok) throw new Error(result.reason);
			before = current;
			return result.text;
		});
		this.data.undo = { path: file.path, before, after };
		await this.saveSettings();
	}

	async undo(): Promise<void> {
		if (!this.data.undo) { new Notice('There is no undo copy for this view.'); return; }
		await this.applyUndo();
		new Notice('Checkpoint restore undone.');
	}

	private async applyUndo(): Promise<void> {
		const undo = this.data.undo;
		if (!undo) throw new Error('There is no undo copy for this view.');
		const file = this.app.vault.getFileByPath(undo.path);
		if (!file) throw new Error(`${undo.path} is missing.`);
		await this.app.vault.process(file, (current) => {
			if (current !== undo.after) throw new Error(UNDO_CONFLICT);
			return undo.before;
		});
		this.data.undo = null;
		await this.saveSettings();
	}

	async compare(cp: Checkpoint): Promise<void> {
		if (!this.needPro()) return;
		const file = this.app.vault.getFileByPath(cp.path);
		if (!file) throw new Error(`${cp.path} is missing.`);
		const changes = compareCheckpoint(await this.app.vault.read(file), cp);
		if (changes === null) throw new Error('The file is invalid or the saved view is missing.');
		new ChangesModal(this.app, cp, changes).open();
	}

	async saveForFile(path: string, viewName: string): Promise<string | null> {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return null;
		await this.save(file, viewName);
		return `Saved checkpoint for view "${viewName}".`;
	}

	async restoreForFile(path: string, viewName: string): Promise<string> {
		const cp = this.data.free[freeKey(path, viewName)];
		if (!cp) return 'No checkpoint for this view.';
		const file = this.app.vault.getFileByPath(cp.path);
		if (!file) return `${cp.path} is missing.`;
		await this.applyRestore(file, cp, await this.app.vault.read(file));
		return `Restored view "${viewName}".`;
	}

	async undoForFile(): Promise<string> {
		if (!this.data.undo) return 'There is no undo copy for this view.';
		try { await this.applyUndo(); return 'Checkpoint restore undone.'; }
		catch (error) { return error instanceof Error ? error.message : String(error); }
	}
}

class ChoiceModal<T> extends FuzzySuggestModal<T> {
	constructor(app: App, private items: T[], private text: (item: T) => string, private choose: (item: T) => void, placeholder: string) {
		super(app);
		this.setPlaceholder(placeholder);
	}
	getItems(): T[] { return this.items; }
	getItemText(item: T): string { return this.text(item); }
	onChooseItem(item: T): void { this.choose(item); }
}

class NameModal extends Modal {
	constructor(app: App, private save: (label: string) => void) { super(app); }
	onOpen(): void {
		this.setTitle('Save named checkpoint');
		let label = '';
		new Setting(this.contentEl).setName('Checkpoint name').addText((text) => text.setPlaceholder('Weekly review').onChange((value) => { label = value.trim(); }));
		new Setting(this.contentEl).addButton((button) => button.setButtonText('Save').setCta().onClick(() => {
			if (!label) { new Notice('Enter a checkpoint name.'); return; }
			this.close(); this.save(label);
		}));
	}
	onClose(): void { this.contentEl.empty(); }
}

class ChangesModal extends Modal {
	constructor(app: App, protected cp: Checkpoint, protected changes: string[]) { super(app); }
	onOpen(): void {
		this.setTitle(`Compare checkpoint with view ${this.cp.viewName} (Pro)`);
		this.contentEl.createEl('p', { text: `${this.cp.label ?? 'Free checkpoint'} · ${this.cp.path}` });
		const list = this.contentEl.createEl('ul', { cls: 'checkpoint-changes' });
		if (!this.changes.length) list.createEl('li', { text: 'No keys change.' });
		else for (const key of this.changes) list.createEl('li', { text: key });
	}
	onClose(): void { this.contentEl.empty(); }
}

class RestorePreviewModal extends ChangesModal {
	constructor(app: App, cp: Checkpoint, changes: string[], private confirm: () => void) { super(app, cp, changes); }
	onOpen(): void {
		super.onOpen();
		this.setTitle(`Restore checkpoint of view ${this.cp.viewName}`);
		this.contentEl.createEl('p', { text: 'Shared filters, formulas, properties and summaries can affect the other views of this base. Shared keys added after the save are removed.' });
		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((button) => button.setButtonText('Restore').setCta().onClick(() => { this.close(); this.confirm(); }));
	}
}

function validMap(value: unknown, named: boolean): Record<string, Checkpoint> {
	if (!value || typeof value !== 'object') return {};
	const out: Record<string, Checkpoint> = {};
	for (const item of Object.values(value)) {
		if (!item || typeof item !== 'object') continue;
		const cp = item as Checkpoint;
		if (typeof cp.path !== 'string' || typeof cp.viewName !== 'string' || !cp.view || typeof cp.view !== 'object' || !cp.shared || typeof cp.shared !== 'object') continue;
		if (named) {
			// A named checkpoint without a label would pass as a free one and skip the Pro check.
			if (typeof cp.label !== 'string' || !cp.label) continue;
			out[namedKey(cp)] = cp;
		} else out[freeKey(cp.path, cp.viewName)] = { ...cp, label: undefined };
	}
	return out;
}
