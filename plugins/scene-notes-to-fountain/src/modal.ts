import { Modal, Notice, Setting, type EventRef, type TAbstractFile } from 'obsidian';
import { errorText, move } from './fountain';
import { isPro } from './pro';
import type SceneNotesToFountainPlugin from './main';
import type { SavePlan, SaveResult } from './main';

/** The export window: choose a folder, select and order notes, preview, then save a new .fountain file. */
export class ExportModal extends Modal {
	folder: string;
	/** Paths of the notes in the folder, in the export order. */
	order: string[] = [];
	selected = new Set<string>();
	fileName: string;
	/** The current save plan. Null before a preview and after a selected note changes. */
	current: SavePlan | null = null;
	/** Text of the status line above the preview. */
	status = '';
	private modifyRef: EventRef | null = null;
	private previewVersion = 0;
	private previewPending = false;
	private saving = false;

	constructor(
		readonly plugin: SceneNotesToFountainPlugin,
		folder: string,
	) {
		super(plugin.app);
		this.folder = folder;
		this.fileName = plugin.defaultFileName();
		this.setFolder(folder);
	}

	/** Paths of the selected notes, in the export order. */
	selectedPaths(): string[] {
		return this.order.filter((p) => this.selected.has(p));
	}

	setFolder(folder: string): void {
		this.folder = folder;
		this.order = this.plugin.notesIn(folder).map((f) => f.path);
		this.selected = new Set(this.order);
		this.invalidate('');
	}

	/** Moves the note at index i of the order one place up (-1) or down (+1). */
	moveNote(i: number, dir: -1 | 1): void {
		this.order = move(this.order, i, dir);
		this.invalidate('The order changed. Select Preview again.');
		this.render();
	}

	toggle(path: string, on: boolean): void {
		if (on) this.selected.add(path);
		else this.selected.delete(path);
		this.invalidate('The selection changed. Select Preview again.');
		this.render();
	}

	private invalidate(status: string): void {
		this.previewVersion++;
		this.previewPending = false;
		this.current = null;
		this.status = status;
	}

	/** Builds the preview from the current selection and order. Reads notes, writes nothing. */
	async preview(): Promise<void> {
		this.invalidate('Building the preview.');
		const version = this.previewVersion;
		this.previewPending = true;
		this.render();
		try {
			const current = await this.plugin.makePlan(this.selectedPaths());
			if (version !== this.previewVersion) return;
			this.current = current;
			const p = current.plan;
			this.status = p.text === null ? `Fix ${p.errors.length === 1 ? 'this problem' : `these ${p.errors.length} problems`} before you save.` : `Preview of ${p.scenes.length} scenes. The source notes do not change.`;
		} catch {
			if (version !== this.previewVersion) return;
			this.status = 'Cannot read the selected notes. Select Preview to try again.';
		} finally {
			if (version === this.previewVersion) {
				this.previewPending = false;
				this.render();
			}
		}
	}

	/** Saves the current plan. If a note changed after the preview, it builds the preview again and saves nothing. */
	async save(): Promise<string | null> {
		if (!this.current || this.current.plan.text === null || this.saving) return null;
		this.saving = true;
		let r: SaveResult;
		try {
			r = await this.plugin.savePlan(this.current, this.folder, this.fileName);
		} catch (e) {
			this.status = `Cannot save the file: ${errorText(e)}`;
			this.render();
			return null;
		} finally {
			this.saving = false;
		}
		if (r.status === 'saved') {
			new Notice(`Saved ${r.file.path}`);
			this.close();
			return r.file.path;
		}
		if (r.status === 'stale') {
			await this.preview();
			this.status = 'A selected note changed after the preview. Check the new preview, then save again.';
			this.render();
		}
		return null;
	}

	onOpen(): void {
		this.setTitle('Export notes to a .fountain outline');
		this.modalEl.addClass('scene-notes-to-fountain');
		this.modifyRef = this.app.vault.on('modify', (file: TAbstractFile) => this.onModify(file));
		this.render();
	}

	onClose(): void {
		this.invalidate('');
		if (this.modifyRef) this.app.vault.offref(this.modifyRef);
		this.modifyRef = null;
		this.contentEl.empty();
	}

	/** A selected note changed: the old plan is no longer valid, so build the preview again. */
	private onModify(file: TAbstractFile): void {
		if ((!this.current && !this.previewPending) || !this.selected.has(file.path)) return;
		void this.preview();
	}

	render(): void {
		const el = this.contentEl;
		el.empty();
		new Setting(el)
			.setName('Folder')
			.setDesc('Notes directly in this folder.')
			.addDropdown((d) => {
				for (const f of this.plugin.folders()) d.addOption(f, f === '/' ? 'Vault root' : f);
				if (!this.plugin.folders().includes(this.folder)) d.addOption(this.folder, this.folder);
				d.setValue(this.folder).onChange((v) => {
					this.setFolder(v);
					this.render();
				});
			});

		const list = el.createDiv({ cls: 'snf-notes' });
		if (!this.order.length) list.createEl('p', { text: 'This folder has no Markdown notes.', cls: 'snf-empty' });
		this.order.forEach((path, i) => {
			const name = path.split('/').pop()!.replace(/\.md$/, '');
			new Setting(list)
				.setName(name)
				.setClass('snf-note')
				.addToggle((t) => t.setValue(this.selected.has(path)).setTooltip('Include this note').onChange((v) => this.toggle(path, v)))
				.addExtraButton((b) =>
					b
						.setIcon('arrow-up')
						.setTooltip('Move up')
						.setDisabled(i === 0)
						.onClick(() => this.moveNote(i, -1)),
				)
				.addExtraButton((b) =>
					b
						.setIcon('arrow-down')
						.setTooltip('Move down')
						.setDisabled(i === this.order.length - 1)
						.onClick(() => this.moveNote(i, 1)),
				);
		});

		new Setting(el)
			.setName('File name')
			.setDesc('A new file. If the name is in use, a number is added.')
			.addText((t) =>
				t.setValue(this.fileName).onChange((v) => {
					this.fileName = v;
				}),
			);

		const out = el.createDiv({ cls: 'snf-preview' });
		if (this.status) out.createEl('p', { text: this.status, cls: 'snf-status' });
		const plan = this.current?.plan;
		if (plan && plan.errors.length) {
			const ul = out.createEl('ul', { cls: 'snf-errors' });
			for (const e of plan.errors) ul.createEl('li', { text: e.path ? `${e.path}: ${e.message}` : e.message });
		}
		if (plan && plan.text !== null) out.createEl('pre', { text: plan.text, cls: 'snf-text' });

		const buttons = new Setting(el)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((b) => b.setButtonText('Preview').onClick(() => void this.preview()))
			.addButton((b) =>
				b
					.setButtonText('Save')
					.setCta()
					.setDisabled(!this.current || this.current.plan.text === null)
					.onClick(() => void this.save()),
			);
		buttons.addButton((b) => b.setButtonText(isPro() ? 'Save as note group' : 'Save as note group (Pro)').onClick(() => void this.saveGroup()));
	}

	/** Pro: saves the selection and order as a note group named after the file name. */
	async saveGroup(): Promise<boolean> {
		const paths = this.selectedPaths();
		if (!paths.length) {
			new Notice('Select one or more notes first.');
			return false;
		}
		const ok = await this.plugin.saveGroup(this.fileName, this.folder, paths);
		if (ok) new Notice(`Saved the note group with ${paths.length} notes.`);
		return ok;
	}
}
