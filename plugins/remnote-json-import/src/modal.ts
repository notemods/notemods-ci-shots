import { Modal, Notice, Setting, type App, type ButtonComponent } from 'obsidian';
import { DEFAULT_LAYOUT, MAX_BYTES, planImport, type Layout, type Changes } from './importer';
import { isPro } from './pro';
import type RemNoteJsonImportPlugin from './main';

export class ImportModal extends Modal {
 text = '';
 layout: Layout;
 private source!: HTMLTextAreaElement;
 private folderInput!: HTMLInputElement;
 private prefixInput!: HTMLInputElement;
 private rootsInput!: HTMLInputElement;
 private preview!: HTMLElement;
 private importButton!: ButtonComponent;
 private busy = false;
 private ready = false;
 constructor(app: App, readonly importer: RemNoteJsonImportPlugin) { super(app); this.layout = { ...DEFAULT_LAYOUT, folder: importer.settings.folder, groupRoots: [] }; }
 onOpen(): void {
  this.setTitle(this.importer.manifest.name); this.modalEl.addClass('remnote-import-modal');
  const el = this.contentEl; el.empty();
  el.createEl('p', { text: 'Select rem.json or paste its JSON. Preview the supported notes and warnings before import. Keep the export and its attachments.' });
  const file = el.createEl('input', { type: 'file', attr: { accept: '.json,application/json', 'aria-label': 'Select rem.json' } });
  file.addEventListener('change', () => void this.readFile(file));
  this.source = el.createEl('textarea', { cls: 'remnote-import-source', attr: { 'aria-label': 'Source JSON', placeholder: '{ "docs": [...] }', rows: '4', spellcheck: 'false' } });
  this.source.value = this.text;
  this.source.addEventListener('input', () => { this.text = this.source.value; this.invalidate(); });
  new Setting(el).setName('Destination folder').setDesc('Use a new folder. Existing notes are not replaced.').addText(t => { this.folderInput = t.inputEl; t.setValue(this.layout.folder).onChange(v => { this.layout.folder = v; this.invalidate(); }); });
  new Setting(el).setName('Filename prefix').setDesc('Optional text before the title and stable source tag.').addText(t => { this.prefixInput = t.inputEl; t.setValue(this.layout.prefix).onChange(v => { this.layout.prefix = v; this.invalidate(); }); });
  new Setting(el).setName('Pro subtree roots').setDesc('Enter source identifiers separated by commas. Each selected subtree becomes one document.').addText(t => { this.rootsInput = t.inputEl; t.setValue(this.layout.groupRoots.join(', ')).setDisabled(!isPro()).onChange(v => { this.layout.groupRoots = v.split(',').map(s => s.trim()).filter(Boolean); this.invalidate(); }); });
  const presets = new Setting(el).setName('Pro layout presets');
  let presetName = '';
  presets.addText(t => t.setPlaceholder('Preset name').onChange(v => { presetName = v; }));
  presets.addButton(b => b.setButtonText('Save preset').onClick(() => this.run(async () => { await this.importer.savePreset(presetName, this.layout); new Notice('Layout preset saved.'); })));
  for (const preset of this.importer.settings.presets) presets.addButton(b => b.setButtonText(preset.name).onClick(() => this.run(() => { this.setLayout(this.importer.applyPreset(preset.name)); })));
  const controls = new Setting(el).setName('Review and import');
  controls.addButton(b => b.setButtonText('Preview').onClick(() => this.run(() => this.showPreview())));
  controls.addButton(b => b.setButtonText('Pro change preview').onClick(() => this.run(() => this.showChanges())));
  controls.addButton(b => { this.importButton = b; b.setButtonText('Create notes').setCta().setDisabled(true).onClick(() => this.run(async () => {
   if (!this.ready) return;
   this.busy = true; this.importButton.setDisabled(true);
   try { const result = await this.importer.importText(this.text, this.layout); this.ready = false; this.preview.empty(); this.preview.createEl('p', { text: `${result.complete ? 'Import complete' : 'Import stopped'}: ${result.written.length} notes written. ${result.reportWritten ? `Read ${this.layout.folder}/Import report.md.` : 'The report could not be written.'}` }); } finally { this.busy = false; }
  })); });
  this.preview = el.createDiv({ cls: 'remnote-import-preview', attr: { 'aria-live': 'polite' } });
 }
 onClose(): void { this.importer.modals.delete(this); this.contentEl.empty(); }
 private async run(action: () => void | Promise<void>): Promise<void> { try { await action(); } catch (error) { new Notice(error instanceof Error ? error.message : String(error)); } }
 private async readFile(input: HTMLInputElement): Promise<void> {
  await this.run(async () => {
   const file = input.files?.[0]; if (!file) return;
   if (file.size > MAX_BYTES) throw new Error('The file is larger than 20 MiB. Export a smaller selection.');
   this.text = await file.text(); this.source.value = this.text; this.invalidate(); this.showPreview();
  });
 }
 setLayout(layout: Layout): void { this.layout = { ...layout, groupRoots: [...layout.groupRoots] }; this.folderInput.value = layout.folder; this.prefixInput.value = layout.prefix; this.rootsInput.value = layout.groupRoots.join(', '); this.invalidate(); }
 invalidate(): void { this.ready = false; this.importButton?.setDisabled(true); this.preview?.empty(); }
 proChanged(): void { this.rootsInput?.toggleAttribute('disabled', !isPro()); if (!isPro() && this.layout.groupRoots.length) { this.layout.groupRoots = []; if (this.rootsInput) this.rootsInput.value = ''; } this.invalidate(); }
 showPreview(): void {
  if (this.busy) return;
  this.invalidate(); if (this.layout.groupRoots.length) this.importer.requirePro();
  const plan = planImport(this.text, this.layout); const exists = !!this.app.vault.getAbstractFileByPath(plan.folder);
  const el = this.preview; el.createEl('p', { text: `${plan.count} source Rems → ${plan.notes.length} notes. ${plan.warnings.length} warnings.`, cls: 'remnote-import-count' });
  if (exists) el.createEl('p', { text: 'The destination exists. Choose a new folder before import.', cls: 'remnote-import-warning' });
  const list = el.createEl('ul');
  for (const note of plan.notes.slice(0, 8)) list.createEl('li', { text: note.path });
  if (plan.notes.length > 8) el.createEl('p', { text: `${plan.notes.length - 8} more notes. The report lists written paths.` });
  if (plan.warnings.length) { new Setting(el).setName('Import warnings').setHeading(); const warningList = el.createEl('ul'); for (const w of plan.warnings.slice(0, 8)) warningList.createEl('li', { text: `${w.id}: ${w.type} — ${w.detail}` }); if (plan.warnings.length > 8) el.createEl('p', { text: `${plan.warnings.length - 8} more warnings will be in the report.` }); }
  if (plan.notes[0]) { new Setting(el).setName('First note as Markdown').setHeading(); el.createEl('pre', { text: plan.notes[0].content, cls: 'remnote-import-markdown' }); }
  this.ready = !exists && plan.notes.length > 0; this.importButton.setDisabled(!this.ready);
 }
 private showChanges(): void {
  const changes = this.importer.previewChanges(this.text); this.invalidate();
  this.preview.createEl('p', { text: `${changes.added.length} added, ${changes.changed.length} changed, ${changes.removed.length} removed, ${changes.unchanged.length} unchanged source Rems.` });
  for (const [label, ids] of Object.entries(changes) as [keyof Changes, string[]][]) { new Setting(this.preview).setName(label.charAt(0).toUpperCase() + label.slice(1)).setHeading(); this.preview.createEl('p', { text: ids.slice(0, 20).join(', ') || 'None.' }); }
  this.preview.createEl('p', { text: 'This compares source records with the last complete import. It does not change existing notes.' });
 }
}
