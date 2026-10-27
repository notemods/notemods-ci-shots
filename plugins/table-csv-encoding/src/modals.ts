import { Modal, Notice, Setting, type App, type Editor, type TFile } from 'obsidian';
import { csvFileStem, encodeTableCsv, markdownCsvTables, type MarkdownCsvTable, type TableCsvOptions } from './core/index';
import type TableCsvEncodingPlugin from './main';
import type { CsvBatch } from './main';

function controls(el: HTMLElement, options: TableCsvOptions, update: () => void): void {
 new Setting(el).setName('Delimiter').addDropdown((d) => d.addOptions({ ',': 'Comma', ';': 'Semicolon', '\t': 'Tab' }).setValue(options.delimiter).onChange((value) => { options.delimiter = value as TableCsvOptions['delimiter']; update(); }));
 new Setting(el).setName('UTF-8 byte order mark').setDesc('Add an encoding marker so CSV readers can detect UTF-8.').addToggle((t) => t.setValue(options.bom).onChange((value) => { options.bom = value; update(); }));
 new Setting(el).setName('Include header row').addToggle((t) => t.setValue(options.headers).onChange((value) => { options.headers = value; update(); }));
}
export class ExportModal extends Modal {
 readonly snapshot: string;
 readonly tables: MarkdownCsvTable[];
 index: number;
 readonly options: TableCsvOptions;
 private name: string;
 private preview: HTMLElement | null = null;
 private info: HTMLElement | null = null;
 private setNameInput: (value: string) => void = () => undefined;
 private saveButton: HTMLButtonElement | null = null;
 private readonly sourcePath: string;
 constructor(app: App, private readonly owner: TableCsvEncodingPlugin, private readonly editor: Editor, private readonly source: TFile) {
  super(app); this.snapshot = editor.getValue(); this.tables = markdownCsvTables(this.snapshot);
  this.sourcePath = source.path;
  if (!this.tables.length) throw new Error('No Markdown pipe table found in this note.');
  const line = editor.getCursor().line + 1;
  this.index = Math.max(0, this.tables.findIndex((t) => t.line <= line && t.endLine >= line));
  this.name = source.basename + '-table-' + (this.index + 1);
  this.options = { delimiter: owner.settings.delimiter, bom: owner.settings.bom, headers: owner.settings.headers };
 }
 onOpen(): void {
  this.setTitle('Export a Markdown table as CSV'); this.modalEl.addClass('table-csv-modal');
  this.contentEl.createEl('p', { text: this.source.path });
  new Setting(this.contentEl).setName('Table').addDropdown((d) => {
   for (const [i, table] of this.tables.entries()) d.addOption(String(i), `${i + 1}: ${table.rows[0]?.join(' / ')} (line ${table.line})`);
   d.setValue(String(this.index)).onChange((value) => {
    this.index = Number(value); this.name = this.source.basename + '-table-' + (this.index + 1);
    this.setNameInput(this.name); this.update();
   });
  });
  controls(this.contentEl, this.options, () => this.update());
  new Setting(this.contentEl).setName('File name').setDesc('A .csv extension is added. Existing files keep their data.').addText((input) => {
   this.setNameInput = (value) => { input.setValue(value); };
   input.setValue(this.name).onChange((value) => { this.name = value; this.update(); });
  });
  this.info = this.contentEl.createEl('p', { cls: 'table-csv-summary', attr: { role: 'status' } });
  this.preview = this.contentEl.createEl('pre', { cls: 'table-csv-preview' });
  this.contentEl.createEl('p', { text: 'The preview shows cell source text. The source note stays as written.' });
  new Setting(this.contentEl).addButton((b) => b.setButtonText('Cancel').onClick(() => this.close())).addButton((b) => {
   this.saveButton = b.buttonEl;
   b.setButtonText('Save CSV file').setCta().onClick(async () => {
   b.setDisabled(true);
   try { await this.owner.saveTable(this.editor, this.snapshot, this.source, this.index, this.name, this.options, this.sourcePath); this.close(); }
   catch (error) { new Notice(error instanceof Error ? error.message : 'The export failed.'); b.setDisabled(false); }
   });
  });
  this.update();
 }
 update(): void {
  const table = this.tables[this.index]!;
  let stem: string;
  try { stem = csvFileStem(this.name); } catch { stem = '(enter a file name)'; }
  this.info?.setText(table.problem ?? `${table.rows.length - 1} data rows · ${table.rows[0]!.length} columns · UTF-8 ${this.options.bom ? 'with BOM (EF BB BF)' : 'without BOM'} · ${stem}.csv`);
  const csv = encodeTableCsv(table.rows, this.options);
  this.preview?.setText(csv.replace(/^\uFEFF/, '').slice(0, 30000));
  if (this.saveButton) this.saveButton.disabled = !!table.problem || stem === '(enter a file name)';
 }
 onClose(): void { this.contentEl.empty(); }
}

export class BatchModal extends Modal {
 private folder: string;
 private plan: CsvBatch | null = null;
 private closed = false;
 private revision = 0;
 private list: HTMLElement | null = null;
 constructor(app: App, private readonly owner: TableCsvEncodingPlugin) { super(app); this.folder = owner.settings.batchFolder; }
 onOpen(): void {
  this.setTitle('Export folder tables · pro'); this.modalEl.addClass('table-csv-modal');
  this.contentEl.createEl('p', { text: 'Prepare a list before writing files. Exports go into a new vault folder. Source notes stay as written.' });
  new Setting(this.contentEl).setName('Source folder').setDesc('An empty path scans the vault.').addText((input) => input.setValue(this.folder).onChange((value) => { this.folder = value; this.revision++; this.plan = null; this.list?.setText('Prepare the changed folder again.'); }));
  const options: TableCsvOptions = { delimiter: this.owner.settings.delimiter, bom: this.owner.settings.bom, headers: this.owner.settings.headers };
  controls(this.contentEl, options, () => { this.revision++; this.plan = null; this.list?.setText('Prepare the changed format again.'); });
  this.list = this.contentEl.createDiv({ cls: 'table-csv-batch-list' });
  new Setting(this.contentEl).addButton((b) => b.setButtonText('Prepare batch').onClick(async () => {
   b.setDisabled(true); this.plan = null;
   const revision = this.revision;
   try {
    const plan = await this.owner.prepareBatch(this.folder, options, () => this.closed || revision !== this.revision);
    if (this.closed || revision !== this.revision) return;
    this.plan = plan; this.list?.empty();
    this.list?.createEl('p', { text: `${plan.sources.length} source notes. ${plan.sources.reduce((n, s) => n + s.outputs.length, 0)} CSV files. ${plan.skipped.length} skipped tables or notes.` });
    const files = this.list?.createEl('ul');
    for (const source of plan.sources) for (const output of source.outputs) files?.createEl('li', { text: source.file.path + ' → ' + output.name });
    for (const skipped of plan.skipped) this.list?.createEl('p', { text: skipped });
   } catch (error) { this.list?.setText(error instanceof Error ? error.message : 'The scan failed.'); }
   finally { b.setDisabled(false); }
  }));
  new Setting(this.contentEl).addButton((b) => b.setButtonText('Cancel').onClick(() => this.close())).addButton((b) => b.setButtonText('Write prepared CSV files').setCta().onClick(async () => {
   if (!this.plan) { new Notice('Prepare a batch first.'); return; }
   b.setDisabled(true);
   try { await this.owner.writeBatch(this.plan); this.close(); }
   catch (error) { new Notice(error instanceof Error ? error.message : 'The batch failed.'); b.setDisabled(false); }
  }));
 }
 onClose(): void { this.closed = true; this.plan = null; this.contentEl.empty(); }
}
