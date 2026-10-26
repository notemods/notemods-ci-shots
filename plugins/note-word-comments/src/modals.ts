// Preview before export, and the Pro note picker for a joined export.
import { Modal, Notice, Setting, TFile, type ButtonComponent } from 'obsidian';
import { planExport, writeExport, type ExportPlan, type NoteSource } from './export';
import { isPro } from './pro';
import type NoteWordCommentsPlugin from './main';

/** Shows the comment count, author, new file name and problems. Export is on only when there are no problems. */
export class PreviewModal extends Modal {
	plan: ExportPlan | null = null;
	private busy = false;

	constructor(
		private plugin: NoteWordCommentsPlugin,
		private sources: NoteSource[],
		private outName?: string,
	) {
		super(plugin.app);
	}

	onOpen(): void {
		this.modalEl.addClass('nwc-modal');
		this.setTitle('Export to a docx file');
		void this.refresh();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	/** Parses the notes again (for example after an author change) and draws the preview. */
	async refresh(): Promise<void> {
		this.modalEl.dataset.state = 'loading';
		this.plan = await planExport(this.app, this.sources, this.plugin.planOptions(), this.outName);
		this.draw();
	}

	private draw(): void {
		const plan = this.plan;
		if (!plan) return;
		const { contentEl } = this;
		contentEl.empty();
		const blocked = plan.problems.length > 0;
		this.modalEl.dataset.state = blocked ? 'blocked' : 'ready';

		new Setting(contentEl)
			.setName('Author')
			.setDesc(this.plugin.planOptions().labels ? 'Name on each comment without a label. A comment that starts with "Name:" uses that name.' : 'Name on each Word comment.')
			.addText((t) =>
				t.setValue(this.plugin.settings.author).onChange(async (v) => {
					this.plugin.settings.author = v;
					await this.plugin.saveSettings();
				}),
			);
		const authorInput = contentEl.querySelector('input');
		authorInput?.addEventListener('blur', () => void this.refresh());

		const facts = contentEl.createEl('ul', { cls: 'nwc-facts' });
		const names = plan.sources.map((s) => s.file.name);
		facts.createEl('li', { text: plan.sources.length === 1 ? `Note: ${names[0] ?? ''}` : `Notes (${names.length}): ${names.join(', ')}` });
		facts.createEl('li', { text: `Comments: ${plan.comments.length}`, cls: 'nwc-count' });
		const authors = [...new Set(plan.comments.map((c) => c.author))];
		if (authors.length) facts.createEl('li', { text: `Authors: ${authors.join(', ')}` });
		facts.createEl('li', { text: `New file: ${plan.path}`, cls: 'nwc-path' });

		const buttons = new Setting(contentEl);
		let exportBtn: ButtonComponent | null = null;
		buttons.addButton((b) => {
			exportBtn = b;
			b.setButtonText('Export')
				.setCta()
				.setDisabled(blocked)
				.onClick(() => void this.runExport(b));
		});
		buttons.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()));
		if (exportBtn) (exportBtn as ButtonComponent).buttonEl.addClass('nwc-export');

		if (blocked) {
			const box = contentEl.createDiv({ cls: 'nwc-problems' });
			box.createEl('p', { text: `Export stopped. ${plan.problems.length === 1 ? 'One problem' : `${plan.problems.length} problems`}. Change the note, then run the command again. The note is unchanged.` });
			const ul = box.createEl('ul');
			for (const p of plan.problems.slice(0, 50)) ul.createEl('li', { text: p });
			if (plan.problems.length > 50) ul.createEl('li', { text: `and ${plan.problems.length - 50} more` });
		}

		const sample = plan.comments.slice(0, 8);
		if (sample.length) {
			const box = contentEl.createDiv({ cls: 'nwc-comments' });
			box.createEl('p', { text: 'Comments in the export:' });
			const ul = box.createEl('ul');
			for (const c of sample) ul.createEl('li', { text: `${c.anchor}: ${c.text} (${c.author})` });
			if (plan.comments.length > sample.length) ul.createEl('li', { text: `and ${plan.comments.length - sample.length} more` });
		}
	}

	private async runExport(btn: ButtonComponent): Promise<void> {
		if (this.busy || !this.plan || this.plan.problems.length) return;
		this.busy = true;
		btn.setDisabled(true);
		try {
			// Use the newest author: the text field can change without a blur.
			this.plan = await planExport(this.app, this.sources, this.plugin.planOptions(), this.outName);
			if (this.plan.problems.length) {
				this.draw();
				return;
			}
			const file = await writeExport(this.app, this.plan);
			this.plugin.lastExport = file.path;
			new Notice(`Word Comment Export: wrote ${file.path} with ${this.plan.comments.length} comments.`);
			this.modalEl.dataset.state = 'done';
			this.close();
		} catch (e) {
			this.modalEl.dataset.state = 'error';
			new Notice(`Word Comment Export: export failed. ${e instanceof Error ? e.message : String(e)}`);
			btn.setDisabled(false);
		} finally {
			this.busy = false;
		}
	}
}

/** Pro: pick notes of a folder to join in one document, in name order. */
export class PickNotesModal extends Modal {
	readonly picked = new Set<string>();

	constructor(
		private plugin: NoteWordCommentsPlugin,
		private files: TFile[],
		private folderName: string,
	) {
		super(plugin.app);
		for (const f of files) this.picked.add(f.path);
	}

	onOpen(): void {
		this.modalEl.addClass('nwc-modal');
		this.modalEl.dataset.state = 'ready';
		this.setTitle('Join notes in one docx file');
		const { contentEl } = this;
		contentEl.createEl('p', { text: `Notes in ${this.folderName}, in name order. Each note after the first starts on a new page.` });
		for (const f of this.files) {
			new Setting(contentEl).setName(f.basename).addToggle((t) =>
				t.setValue(true).onChange((v) => {
					if (v) this.picked.add(f.path);
					else this.picked.delete(f.path);
				}),
			);
		}
		new Setting(contentEl).addButton((b) =>
			b
				.setButtonText('Continue')
				.setCta()
				.onClick(() => void this.next()),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	async next(): Promise<void> {
		if (!isPro()) return;
		const chosen = this.files.filter((f) => this.picked.has(f.path));
		if (chosen.length === 0) {
			new Notice('Select one or more notes.');
			return;
		}
		const sources = await this.plugin.readSources(chosen);
		this.close();
		new PreviewModal(this.plugin, sources, this.folderName).open();
	}
}
