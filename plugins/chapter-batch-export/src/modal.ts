import { Modal, Notice, Setting, type TFile, type ButtonComponent } from 'obsidian';
import { DEFAULT_OPTIONS, type ExportOptions } from './core';
import { isPro, onProChange, PRO_LEAD, proNotice, proText } from './pro';
import type ChapterBatchExportPlugin from './main';
import type { Preview } from './main';

export class ExportModal extends Modal {
	options: ExportOptions;
	preview: Preview | null = null;
	private results!: HTMLElement;
	private message!: HTMLElement;
	private exportButton!: ButtonComponent;
	private stop: (() => void) | null = null;
	private revision = 0;
	private saving = false;
	private closed = false;
	private selectedPreset = '';
	constructor(private plugin: ChapterBatchExportPlugin, private file: TFile) {
		super(plugin.app);
		this.options = { ...DEFAULT_OPTIONS, folder: plugin.settings.outputFolder };
	}
	onOpen(): void {
		this.setTitle('Chapter batch export');
		this.modalEl.addClass('chapter-batch-export-modal');
		this.draw();
		this.stop = onProChange(() => { if (!this.closed) { this.preview = null; this.draw(); void this.refresh(); } });
		void this.refresh();
	}
	onClose(): void { this.plugin.modals.delete(this); this.closed = true; this.revision++; this.stop?.(); this.stop = null; this.contentEl.empty(); }
	private draw(): void {
		this.contentEl.empty();
		this.contentEl.createEl('p', { text: `Source index: ${this.file.path}`, cls: 'cbe-source' });
		this.contentEl.createEl('p', { text: 'Join each root scene and its child scenes in saved order. Export writes a new folder in this vault.' });
		this.field('Output folder', 'The parent folder must exist. Use a new name for each export.', 'folder', false);
		const proPanel = this.contentEl.createEl('details', { cls: 'cbe-pro' });
		proPanel.createEl('summary', { text: 'Export presets and formats (pro)' });
		proPanel.open = isPro();
		if (!isPro()) proPanel.createEl('p', { text: proText('The full chapter export is free. Named presets, chapter ranges, and formats need pro.'), cls: 'cbe-muted' });
		this.field('Chapter range (pro)', 'Empty selects the root chapters. Example: 1-3, 5.', 'range', true, proPanel);
		this.field('Heading format (pro)', 'Use {title} and {number}. Empty adds no chapter heading.', 'heading', true, proPanel);
		this.field('Filename format (pro)', 'Use {title} and {number}. The .md extension is added.', 'filename', true, proPanel);
		new Setting(proPanel).setName('Named presets (pro)').addDropdown((select) => {
			select.addOption('', 'Choose a preset');
			for (const preset of this.plugin.settings.presets) select.addOption(preset.name, preset.name);
			select.setValue(this.selectedPreset).onChange((name) => {
				// A free user can open the list. A select shows the Pro notice and the list goes back. setValue fires no change.
				if (!isPro()) { select.setValue(this.selectedPreset); proNotice(PRO_LEAD); return; }
				this.selectedPreset = name;
				const preset = this.plugin.settings.presets.find((p) => p.name === name);
				if (preset) { this.options = { folder: preset.folder, range: preset.range, heading: preset.heading, filename: preset.filename }; this.draw(); void this.refresh(); }
			});
		});
		let presetName = '';
		new Setting(proPanel).setName('Save preset (pro)').addText((text) => text.setPlaceholder('Preset name').onChange((value) => { presetName = value; })).addButton((button) => button.setButtonText('Save preset').onClick(async () => {
			if (!isPro()) { proNotice(PRO_LEAD); return; }
			try { await this.plugin.savePreset(presetName, this.options); this.selectedPreset = presetName.trim(); new Notice('Saved the export preset.'); this.draw(); await this.refresh(); }
			catch (error) { this.showError(error); }
		}));
		this.message = this.contentEl.createDiv({ cls: 'cbe-message', attr: { role: 'status', 'aria-live': 'polite' } });
		this.results = this.contentEl.createDiv({ cls: 'cbe-results' });
		new Setting(this.contentEl).addButton((button) => button.setButtonText('Refresh preview').onClick(() => { void this.refresh(); })).addButton((button) => {
			this.exportButton = button; button.buttonEl.addClass('cbe-export');
			button.setButtonText('Save chapters').setCta().setDisabled(true).onClick(async () => {
				if (!this.preview || this.saving) return;
				this.saving = true; button.setDisabled(true);
				try { const folder = await this.plugin.exportPreview(this.preview); this.message.setText(`Saved ${this.preview.plan.chapters.length} ${this.preview.plan.chapters.length === 1 ? 'chapter' : 'chapters'} and _index.md in ${folder}.`); this.message.dataset.status = 'saved'; this.preview = null; }
				catch (error) { this.showError(error); }
				finally { this.saving = false; }
			});
		});
	}
	private field(name: string, desc: string, key: keyof ExportOptions, pro: boolean, container = this.contentEl): void {
		new Setting(container).setName(name).setDesc(desc).addText((text) => {
			text.inputEl.dataset.field = key;
			if (pro && !isPro()) {
				// A free user can select the field. It is read-only, and a click or a typed key shows the Pro notice.
				text.inputEl.readOnly = true;
				text.inputEl.addEventListener('click', () => this.refuse(key));
				text.inputEl.addEventListener('keydown', (event) => { if (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete') this.refuse(key); });
			}
			text.setValue(this.options[key]).onChange((value) => {
				if (this.saving || (pro && !isPro())) return;
				this.options[key] = value; this.revision++; this.preview = null; this.exportButton.setDisabled(true);
				this.message.setText('Options changed. Refresh the preview before you save.'); this.message.dataset.status = 'changed';
			});
		});
	}
	private refused = { key: '', at: 0 };
	/** Shows the Pro notice for a read-only Pro field. Keys right after a notice for the same field show no second notice. */
	private refuse(key: string): void {
		const now = Date.now();
		if (this.refused.key === key && now - this.refused.at < 3000) return;
		this.refused = { key, at: now };
		proNotice(PRO_LEAD);
	}
	private showError(error: unknown): void {
		this.message.setText(error instanceof Error ? error.message : String(error));
		this.message.dataset.status = 'error';
	}
	async refresh(): Promise<void> {
		if (this.saving || this.closed) return;
		const revision = ++this.revision; this.preview = null; this.exportButton.setDisabled(true);
		this.message.setText('Read the source scenes…'); this.message.dataset.status = 'loading';
		try {
			const preview = await this.plugin.prepare(this.file.path, { ...this.options });
			if (this.closed || revision !== this.revision) return;
			this.preview = preview; this.results.empty();
			const table = this.results.createEl('table', { cls: 'cbe-table' });
			const head = table.createEl('thead').createEl('tr');
			for (const title of ['Chapter', 'Output file', 'Source scenes']) head.createEl('th', { text: title });
			const body = table.createEl('tbody');
			for (const chapter of preview.plan.chapters) {
				const row = body.createEl('tr'); row.createEl('td', { text: `${chapter.number}. ${chapter.title}` }); row.createEl('td', { text: chapter.filename });
				const cell = row.createEl('td'); for (const source of chapter.sources) cell.createDiv({ text: source, cls: preview.plan.missing.includes(source) ? 'cbe-missing' : '' });
			}
			if (preview.plan.missing.length) {
				const count = preview.plan.missing.length; this.message.setText(`Export stopped: ${count} missing scene ${count === 1 ? 'path' : 'paths'}. Fix ${count === 1 ? 'this path' : 'these paths'}, then refresh.`); this.message.dataset.status = 'missing';
			} else {
				this.message.setText(`${preview.plan.chapters.length} ${preview.plan.chapters.length === 1 ? 'chapter' : 'chapters'} ready. Destination: ${preview.options.folder}. Source frontmatter is removed from the exported text.`); this.message.dataset.status = 'ready'; this.exportButton.setDisabled(false);
			}
			const first = preview.plan.chapters[0];
			if (first) { const details = this.results.createEl('details'); details.createEl('summary', { text: `Text preview: ${first.filename}` }); details.createEl('pre', { text: first.content, cls: 'cbe-text' }); }
		} catch (error) { if (!this.closed && revision === this.revision) { this.results.empty(); this.showError(error); } }
	}
}
