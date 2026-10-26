/* WordPress and Pro keep their product spelling in UI labels. */
/* eslint obsidianmd/ui/sentence-case: ["warn", { "brands": ["WordPress", "Pro"], "acronyms": ["XML", "WXR", "UTF", "UTF-8"] }] -- Keep product names and XML encoding spelling in UI labels. */
import { Modal, Setting, type ButtonComponent } from 'obsidian';
import type WordpressWxrImportPlugin from './main';
import { FIELDS, cleanMapping, type Profile } from './model';
import { MAX_BYTES } from './parser';
import { isPro } from './pro';
export class ImportModal extends Modal {
 private xml = '';
 private folder = 'WordPress import';
 private baseline = '';
 private mapping: Profile['mapping'] = {};
 private profileName = '';
 private revision = 0;
 private selectionRevision = 0;
 private ready = false;
 private busy = false;
 private message: HTMLElement | null = null;
 private preview: HTMLElement | null = null;
 private importButton: ButtonComponent | null = null;
 constructor(private plugin: WordpressWxrImportPlugin, private compare: boolean, private closed: () => void) {
  super(plugin.app); if (compare) this.folder = 'WordPress review';
 }
 onOpen(): void {
  this.titleEl.setText(this.compare ? 'Review a later WordPress export (Pro)' : 'Import WordPress WXR');
  const el = this.contentEl; el.addClass('wxr-import');
  el.createEl('p', { text: 'Select one local UTF-8 XML export. Preview the counts, then create notes in a new folder. The source file stays unchanged.' });
  const picker = el.createEl('input', { attr: { type: 'file', accept: '.xml,text/xml,application/xml', 'aria-label': 'WordPress XML file' } });
  picker.addEventListener('change', () => { void this.selectFile(picker.files?.[0]); });
  new Setting(el).setName('Destination folder').setDesc('Choose a new folder in this vault.').addText((t) => t.setValue(this.folder).onChange((v) => { if (this.folder !== v) { this.folder = v; this.invalidate(); } }));
  if (this.compare) new Setting(el).setName('Baseline import folder (Pro)').setDesc('The earlier import folder with its _source.json file.').addText((t) => t.onChange((v) => { if (this.baseline !== v) { this.baseline = v; this.invalidate(); } }));
  if (isPro()) {
   const profiles = el.createEl('details');
   profiles.createEl('summary', { text: 'Folder and field profiles (Pro)' });
   const controls = profiles.createDiv();
   if (this.plugin.settings.profiles.length) new Setting(controls).setName('Load profile (Pro)').addDropdown((d) => {
    d.addOption('', 'Select a profile');
    this.plugin.settings.profiles.forEach((p, i) => { d.addOption(String(i), p.name); });
    d.onChange((v) => {
     if (!v || !isPro()) return;
     const p = this.plugin.settings.profiles[Number(v)]; if (!p) return;
     this.folder = p.folder; this.mapping = { ...p.mapping }; this.profileName = p.name;
     this.invalidate(); el.empty(); this.onOpen();
    });
   });
   for (const field of FIELDS) new Setting(controls).setName(`${field} property (Pro)`).addText((t) => t.setValue(this.mapping[field] ?? field).onChange((v) => { this.mapping[field] = v; this.invalidate(); }));
   new Setting(controls).setName('Profile name (Pro)').addText((t) => t.setValue(this.profileName).onChange((v) => { this.profileName = v; })).addButton((b) => b.setButtonText('Save profile (Pro)').onClick(async () => {
    try { await this.plugin.saveProfile({ name: this.profileName, folder: this.folder, mapping: cleanMapping(this.mapping) }); this.status('Profile saved.'); }
    catch (e) { this.status(String(e)); }
   }));
  }
  this.preview = el.createDiv({ cls: 'wxr-preview', attr: { 'aria-live': 'polite' } });
  this.message = el.createEl('p', { cls: 'wxr-status', attr: { 'aria-live': 'polite' } });
  new Setting(el).addButton((b) => b.setButtonText('Preview counts').onClick(() => this.showPreview())).addButton((b) => {
   this.importButton = b;
   b.setButtonText('Create notes').setCta().setDisabled(true).onClick(() => this.runImport());
  });
 }
 private invalidate(): void { this.revision++; this.ready = false; if (this.importButton) this.importButton.setDisabled(true); this.preview?.empty(); }
 private status(message: string): void { this.message?.setText(message); }
 async selectFile(file?: File): Promise<void> {
  this.invalidate(); this.xml = '';
  const selection = ++this.selectionRevision;
  if (!file) return;
  try {
   if (file.size > MAX_BYTES) throw new Error('The file exceeds the 20 MiB limit.');
   const xml = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
   const encoding = /^\uFEFF?<\?xml\s[^?]*\bencoding\s*=\s*["']([^"']+)/i.exec(xml)?.[1];
   if (encoding && !/^utf-?8$/i.test(encoding)) throw new Error('Export or convert the XML as UTF-8 first.');
   if (selection !== this.selectionRevision) return;
   this.xml = xml; this.status(`Selected ${file.name}.`); await this.showPreview();
  } catch (e) { if (selection === this.selectionRevision) this.status(String(e)); }
 }
 async showPreview(): Promise<void> {
  this.invalidate(); const revision = this.revision;
  try {
   if (!this.xml) throw new Error('Select a local XML file first.');
   if (this.compare && !this.baseline.trim()) throw new Error('Enter the baseline import folder.');
   const plan = await this.plugin.prepare(this.xml, this.folder, this.mapping, this.baseline);
   if (revision !== this.revision) return;
   if (this.app.vault.getAbstractFileByPath(plan.folder)) throw new Error('The destination folder exists. Choose a new folder.');
   this.preview?.createEl('p', { text: `${plan.parsed.posts} posts · ${plan.parsed.pages} pages · ${plan.noteCount} notes to create` });
   this.preview?.createEl('p', { text: `${plan.parsed.skipped.reduce((n, s) => n + s.count, 0)} skipped records · ${plan.parsed.omittedComments} omitted comments · ${plan.parsed.shortcodes} shortcodes` });
   if (this.compare) this.preview?.createEl('p', { text: plan.changes.map((c) => `${c.id}: ${c.state}`).join(', ') || 'No source changes.' });
   this.ready = true; if (this.importButton) this.importButton.setDisabled(false);
   this.status('Preview ready. Media URLs remain links.');
  } catch (e) { if (revision === this.revision) this.status(String(e)); }
 }
 private async runImport(): Promise<void> {
  if (!this.ready || this.busy) return;
  this.busy = true; this.invalidate(); this.status('Creating notes…');
  try {
   const plan = await this.plugin.importXml(this.xml, this.folder, this.mapping, this.baseline);
   this.status(`Created ${plan.noteCount} notes in ${plan.folder}. Open _index.md and _report.md in that folder.`);
  } catch (e) { this.status(`${String(e)} If a write failed, check the new folder for partial output and use a different destination to retry.`); }
  finally { this.busy = false; }
 }
 onClose(): void { this.selectionRevision++; this.invalidate(); this.contentEl.empty(); this.closed(); }
}
