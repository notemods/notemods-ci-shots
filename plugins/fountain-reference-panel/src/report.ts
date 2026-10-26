import { Modal, Setting, type App } from 'obsidian';

/** Pro: select the notes for the reference report. onExport gets the selected note paths. */
export class ReportModal extends Modal {
	private picked = new Set<string>();

	constructor(
		app: App,
		private notes: { path: string; count: number }[],
		private onExport: (paths: string[]) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('Export a reference report');
		const { contentEl } = this;
		contentEl.addClass('fountain-reference-panel-report');
		if (this.notes.length === 0) {
			contentEl.createEl('p', { text: 'The last scan found no references to Markdown notes. Scan again from the panel, then try again.' });
			return;
		}
		contentEl.createEl('p', { text: 'Select the notes for the report. The report is a new Markdown note in the folder for new notes.' });
		for (const n of this.notes) {
			new Setting(contentEl).setName(n.path).setDesc(`${n.count} ${n.count === 1 ? 'reference' : 'references'}`).addToggle((t) =>
				t.setValue(false).onChange((v) => {
					if (v) this.picked.add(n.path);
					else this.picked.delete(n.path);
				}),
			);
		}
		new Setting(contentEl).addButton((b) =>
			b
				.setButtonText('Export')
				.setCta()
				.onClick(async () => {
					if (this.picked.size === 0) return;
					await this.onExport(this.notes.map((n) => n.path).filter((p) => this.picked.has(p)));
					this.close();
				}),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
