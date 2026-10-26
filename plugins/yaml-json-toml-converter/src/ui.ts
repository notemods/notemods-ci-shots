import { Modal, Setting, normalizePath, type Editor } from 'obsidian';
import { COMMENT_WARNING, convert, errorText, fitLineEnd, FORMATS, parseData, type Format } from './convert';
import { capture, replaceGuarded } from './selection';
import { batchPreview, codeBlocks, type BatchItem } from './batch';
import { validateSchema } from './schema';
import { proTitle } from './pro';
import type DataFormatConverterPlugin from './main';

function formats(el: HTMLElement, name: string, value: Format, change: (value: Format) => void): void {
	new Setting(el).setName(name).addDropdown((d) => {
		d.addOptions(FORMATS).setValue(value).onChange((v) => change(v as Format));
		d.selectEl.setAttribute('aria-label', name);
	});
}
function button(el: HTMLElement, label: string, fn: () => void | Promise<void>, disabled = false): void {
	new Setting(el).addButton((b) => b.setButtonText(label).setDisabled(disabled).onClick(fn));
}

export class ConversionModal extends Modal {
	readonly snapshot;
	source: Format = 'yaml';
	target: Format = 'json';
	output: string | null = null;
	private status!: HTMLElement;
	private preview!: HTMLElement;
	constructor(readonly plugin: DataFormatConverterPlugin, readonly editor: Editor) {
		super(plugin.app);
		this.snapshot = capture(editor);
	}
	onOpen(): void {
		this.plugin.modals.add(this);
		this.setTitle('Convert selected data');
		this.contentEl.addClass('data-format-converter');
		formats(this.contentEl, 'Source format', this.source, (v) => { this.source = v; this.renderPreview(); });
		formats(this.contentEl, 'Target format', this.target, (v) => { this.target = v; this.renderPreview(); });
		this.contentEl.createEl('p', { text: COMMENT_WARNING, cls: 'dfc-warning' });
		this.status = this.contentEl.createEl('p', { cls: 'dfc-status', attr: { role: 'status' } });
		this.preview = this.contentEl.createEl('pre', { cls: 'dfc-preview', attr: { 'aria-label': 'Conversion preview' } });
		button(this.contentEl, 'Replace selection', () => this.replace());
		button(this.contentEl, 'Cancel', () => this.close());
		this.renderPreview();
	}
	renderPreview(): void {
		this.output = null;
		try {
			const result = convert(this.snapshot.source, this.source, this.target);
			this.output = fitLineEnd(result.text, this.snapshot.source, this.target);
			this.preview.setText(this.output.trim() ? this.output : '(Empty TOML table)');
			this.status.setText('Preview ready. Replace selection confirms the change.');
		} catch (e) { this.preview.setText(''); this.status.setText(errorText(e)); }
		const b = this.contentEl.querySelector<HTMLButtonElement>('button');
		if (b) b.disabled = this.output === null;
	}
	replace(): void {
		if (this.output === null) return;
		try { replaceGuarded(this.editor, this.snapshot, this.output); this.close(); }
		catch (e) { this.status.setText(errorText(e)); }
	}
	onClose(): void { this.plugin.modals.delete(this); this.contentEl.empty(); }
}

export class SchemaModal extends Modal {
	readonly snapshot;
	path = '';
	private status!: HTMLElement;
	constructor(readonly plugin: DataFormatConverterPlugin, readonly editor: Editor) { super(plugin.app); this.snapshot = capture(editor); }
	onOpen(): void {
		this.plugin.modals.add(this);
		this.setTitle(proTitle('Validate local JSON schema'));
		this.contentEl.addClass('data-format-converter');
		this.contentEl.createEl('p', { text: 'Use a local JSON schema file. References must start with #. No schema is downloaded. Format keywords are not checked.' });
		new Setting(this.contentEl).setName('Schema path in vault').addText((t) => { t.setPlaceholder('Schemas/person.json').setValue(this.path).onChange((v) => { this.path = v; }); t.inputEl.setAttribute('aria-label', 'Schema path in vault'); });
		this.status = this.contentEl.createEl('p', { cls: 'dfc-status', attr: { role: 'status' } });
		this.contentEl.createEl('pre', { text: this.snapshot.source, cls: 'dfc-preview' });
		button(this.contentEl, 'Validate JSON', () => { this.path = this.contentEl.querySelector<HTMLInputElement>('input')?.value ?? this.path; return this.validate(); });
		button(this.contentEl, 'Close', () => this.close());
	}
	async validate(): Promise<void> {
		if (!this.plugin.requirePro()) { this.status.setText('Pro is off.'); return; }
		try {
			const file = this.app.vault.getFileByPath(normalizePath(this.path.trim()));
			if (!file) throw new Error('Schema file not found in this vault.');
			const text = await this.app.vault.read(file);
			if (!this.plugin.requirePro()) throw new Error('Pro is off.');
			if (this.editor.getValue() !== this.snapshot.document) throw new Error('Source changed. Select the JSON again.');
			const errors = validateSchema(parseData(this.snapshot.source, 'json'), text);
			this.status.setText(errors.length ? errors.join('\n') : 'JSON matches the local schema.');
		} catch (e) { this.status.setText(errorText(e)); }
	}
	onClose(): void { this.plugin.modals.delete(this); this.contentEl.empty(); }
}

export class BatchModal extends Modal {
	readonly document;
	readonly blocks;
	readonly chosen = new Set<number>();
	target: Format = 'json';
	items: BatchItem[] = [];
	private preview!: HTMLElement;
	private status!: HTMLElement;
	private busy = false;
	constructor(readonly plugin: DataFormatConverterPlugin, readonly editor: Editor) {
		super(plugin.app);
		this.document = editor.getValue();
		this.blocks = codeBlocks(this.document);
	}
	onOpen(): void {
		this.plugin.modals.add(this);
		this.setTitle(proTitle('Convert code blocks'));
		this.contentEl.addClass('data-format-converter');
		this.contentEl.createEl('p', { text: 'Choose labelled data blocks. New files go in the vault root. The source note stays intact.' });
		formats(this.contentEl, 'Target format', this.target, (v) => { this.target = v; this.previewBatch(); });
		const list = this.contentEl.createDiv({ cls: 'dfc-block-list' });
		for (const block of this.blocks) new Setting(list).setName(`Block ${block.index} · ${FORMATS[block.source]} · line ${block.line}`).addToggle((t) => { t.setValue(false).onChange((v) => { if (v) this.chosen.add(block.index); else this.chosen.delete(block.index); this.previewBatch(); }); t.toggleEl.setAttribute('aria-label', `Choose block ${block.index}`); });
		this.contentEl.createEl('p', { text: COMMENT_WARNING, cls: 'dfc-warning' });
		this.status = this.contentEl.createEl('p', { cls: 'dfc-status', attr: { role: 'status' } });
		this.preview = this.contentEl.createDiv({ cls: 'dfc-batch-preview' });
		button(this.contentEl, 'Create new files', () => this.createFiles());
		button(this.contentEl, 'Cancel', () => this.close());
		this.previewBatch();
	}
	previewBatch(): void {
		this.items = [];
		this.preview.empty();
		try {
			this.items = batchPreview(this.blocks.filter((b) => this.chosen.has(b.index)), this.target).map((item) => ({ ...item, path: normalizePath(item.path) }));
			for (const item of this.items) {
				if (this.app.vault.getAbstractFileByPath(item.path)) throw new Error(`File already exists: ${item.path}. Move it before this batch.`);
				this.preview.createEl('p', { text: item.path });
				this.preview.createEl('pre', { text: item.text || '(Empty TOML table)', cls: 'dfc-preview' });
			}
			this.status.setText(`${this.items.length} new files in preview. Create new files confirms this batch.`);
		} catch (e) { this.items = []; this.status.setText(errorText(e)); }
		const b = this.contentEl.querySelector<HTMLButtonElement>('button');
		if (b) b.disabled = !this.items.length || this.busy;
	}
	async createFiles(): Promise<void> {
		if (this.busy || !this.items.length || !this.plugin.requirePro()) return;
		this.busy = true;
		const created: string[] = [];
		try {
			for (const item of this.items) {
				if (!this.plugin.requirePro()) throw new Error('Pro is off.');
				if (this.editor.getValue() !== this.document) throw new Error('Source changed. Close this preview and open the batch again.');
				if (this.app.vault.getAbstractFileByPath(item.path)) throw new Error(`File already exists: ${item.path}.`);
			}
			for (const item of this.items) {
				if (!this.plugin.requirePro() || this.editor.getValue() !== this.document) throw new Error('Pro or source changed. Batch stopped.');
				await this.app.vault.create(item.path, item.text);
				created.push(item.path);
			}
			this.status.setText(`Created ${created.length} files. The source note stays intact.`);
			this.items = [];
		} catch (e) { this.status.setText(`${errorText(e)} Created files: ${created.join(', ') || 'none'}.`); }
		finally { this.busy = false; const b = this.contentEl.querySelector<HTMLButtonElement>('button'); if (b) b.disabled = true; }
	}
	onClose(): void { this.plugin.modals.delete(this); this.contentEl.empty(); }
}
