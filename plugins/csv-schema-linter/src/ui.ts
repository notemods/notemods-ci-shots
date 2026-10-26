import { ItemView, Modal, Setting, type WorkspaceLeaf } from 'obsidian';
import type CsvSchemaLinterPlugin from './main';
import type { CheckedFile } from './main';
import { count, type Preview } from './checker';
import { isPro, proText } from './pro';
export const VIEW_ID = 'csv-rule-results';
function table(parent: HTMLElement, headings: string[], rows: (string | number)[][]): void {
 const wrap = parent.createDiv({ cls: 'csv-rule-table-wrap' });
 const table = wrap.createEl('table', { cls: 'csv-rule-table' });
 const head = table.createEl('thead').createEl('tr');
 for (const heading of headings) head.createEl('th', { text: heading });
 const body = table.createEl('tbody');
 for (const row of rows) { const tr = body.createEl('tr'); for (const cell of row) tr.createEl('td', { text: String(cell) }); }
}
export class CheckView extends ItemView {
 constructor(leaf: WorkspaceLeaf, private owner: CsvSchemaLinterPlugin) { super(leaf); }
 getViewType(): string { return VIEW_ID; }
 getDisplayText(): string { return 'CSV rule results'; }
 async onOpen(): Promise<void> { this.render(); await Promise.resolve(); }
 render(): void {
  const el = this.contentEl; el.empty(); el.addClass('csv-rule-results');
  new Setting(el).setName('CSV rule results').setHeading();
  new Setting(el).setName('Local checks').setDesc('Source files stay unchanged. Logical row 1 is the header.')
   .addButton(b => b.setButtonText('Choose CSV').onClick(() => new ChooseModal(this.owner).open()))
   .addButton(b => b.setButtonText('Write report').setDisabled(!this.owner.latest.length).onClick(() => this.owner.safe(() => this.owner.writeReport())));
  if (this.owner.message) el.createEl('p', { text: this.owner.message, cls: 'csv-rule-warning' });
  if (!this.owner.latest.length) el.createEl('p', { text: 'Choose a CSV file and its adjacent rule file to start.' });
  for (const item of this.owner.latest) {
   el.createEl('h3', { text: item.path });
   el.createEl('p', { text: `${count(item.result.rows.length, 'data record')} · ${count(item.result.total, 'error')} · ${item.result.errors.length} shown`, cls: 'csv-rule-summary' });
   if (!item.result.total) el.createEl('p', { text: 'No errors found for these rules.', cls: 'csv-rule-success' });
   else table(el, ['Logical row', 'Column', 'Failed rule', 'Value'], item.result.errors.map(e => [e.row, e.column, e.rule, e.value]));
  }
  new Setting(el).setName('Fix preview (pro)').setDesc(isPro() ? 'Pro is active. Review trim and default changes before writing a new CSV.' : proText('Fix previews and batch checks need Pro.'))
   .addButton(b => b.setButtonText('Preview fixes (pro)').onClick(() => this.owner.safe(() => this.owner.openPreview())))
   .addButton(b => b.setButtonText('Batch check (pro)').onClick(() => { if (this.owner.requirePro()) new BatchModal(this.owner).open(); }));
  if (this.owner.latest.length) {
   let name = '';
   new Setting(el).setName('Save rule set (pro)').setDesc('Keep the rules of the first result under a new name.')
    .addText(t => t.setPlaceholder('Rule set name').onChange(v => { name = v; }))
    .addButton(b => b.setButtonText('Save rules (pro)').onClick(() => this.owner.safe(() => this.owner.saveRuleSet(name))));
  }
 }
}
export class ChooseModal extends Modal {
 constructor(private owner: CsvSchemaLinterPlugin) { super(owner.app); }
 onOpen(): void {
  this.titleEl.setText('Choose a CSV file');
  const files = this.app.vault.getFiles().filter(f => f.extension.toLowerCase() === 'csv').sort((a, b) => a.path.localeCompare(b.path));
  let path = files[0]?.path ?? '';
  new Setting(this.contentEl).setName('CSV file').setDesc('The rule file must be next to it, with .schema.json added to the full CSV name.')
   .addDropdown(d => { for (const file of files) d.addOption(file.path, file.path); d.setValue(path).onChange(v => { path = v; }); });
  this.contentEl.createEl('p', { text: files.length ? 'Example: people.csv uses people.csv.schema.json.' : 'No CSV files found in this vault.' });
  const error = this.contentEl.createEl('p', { cls: 'csv-rule-warning' });
  new Setting(this.contentEl).addButton(b => b.setButtonText('Check CSV').setCta().setDisabled(!path).onClick(async () => {
   b.setDisabled(true);
   try { await this.owner.runCheck(path); this.close(); } catch (e) { error.setText(e instanceof Error ? e.message : String(e)); } finally { b.setDisabled(false); }
  }));
 }
}
export class FixModal extends Modal {
 constructor(private owner: CsvSchemaLinterPlugin, private item: CheckedFile, private preview: Preview) { super(owner.app); }
 onOpen(): void {
  this.titleEl.setText('Fix preview (pro)');
  this.contentEl.createEl('p', { text: `${this.item.path}: ${count(this.preview.total, 'change')}. ${count(this.preview.result.total, 'error')} after fixes. Up to 500 changes shown.` });
  this.contentEl.createEl('p', { text: 'Only trim and default rules change values. Output uses quoted fields. The source file stays unchanged.' });
  table(this.contentEl, ['Logical row', 'Column', 'Before', 'After'], this.preview.changes.map(c => [c.row, c.column, c.before, c.after]));
  new Setting(this.contentEl).addButton(b => b.setButtonText('Write new CSV (pro)').setCta().setDisabled(!this.preview.total).onClick(async () => {
   b.setDisabled(true); await this.owner.safe(async () => { const file = await this.owner.writeFixed(this.item, this.preview); if (file) this.close(); }); b.setDisabled(false);
  }));
 }
}
export class BatchModal extends Modal {
 constructor(private owner: CsvSchemaLinterPlugin) { super(owner.app); }
 onOpen(): void {
  this.titleEl.setText('Batch check (pro)');
  const names = Object.keys(this.owner.settings.ruleSets);
  let name = names[0] ?? '';
  const chosen = new Set<string>();
  new Setting(this.contentEl).setName('Saved rule set').setDesc('Choose 1 to 20 CSV files. This uses a saved copy of the rules.').addDropdown(d => { for (const n of names) d.addOption(n, n); d.setValue(name).onChange(v => { name = v; }); });
  if (!names.length) this.contentEl.createEl('p', { text: 'Check one CSV file, then save its rule set in the results view.' });
  for (const file of this.app.vault.getFiles().filter(f => f.extension.toLowerCase() === 'csv').sort((a, b) => a.path.localeCompare(b.path))) {
   new Setting(this.contentEl).setName(file.path).addToggle(t => t.setValue(false).onChange(v => { if (v) chosen.add(file.path); else chosen.delete(file.path); }));
  }
  new Setting(this.contentEl).addButton(b => b.setButtonText('Check chosen files (pro)').setCta().setDisabled(!name).onClick(async () => {
   b.setDisabled(true); await this.owner.safe(async () => { await this.owner.runBatch([...chosen], name); if (this.owner.latest.length) this.close(); }); b.setDisabled(false);
  }));
 }
}
