import { Modal, Setting, FuzzySuggestModal, Notice, type TFile, type ButtonComponent } from 'obsidian';
import type SecretParcelPlugin from './main';
import { preview, writePayload, filterIds, checkPassphrase, folderPath, type Payload, type Report } from './parcel';
import { PRO_LABEL, isPro } from './pro';
function message(error: unknown): string { return error instanceof Error ? error.message : 'The operation failed.'; }
class ParcelModal extends Modal {
 protected closed = false;
 constructor(protected readonly plugin: SecretParcelPlugin) { super(plugin.app); plugin.closeDialogs(); plugin.modals.add(this); }
 onClose(): void { this.closed = true; this.plugin.modals.delete(this); this.contentEl.empty(); }
}
export class ExportModal extends ParcelModal {
 private selected = new Set<string>();
 private pass = '';
 private button: ButtonComponent | null = null;
 constructor(plugin: SecretParcelPlugin, private ids: string[], private backup = false, private prefix = '', private folder = plugin.prefs.folder) { super(plugin); }
 onOpen(): void {
  this.setTitle(this.backup ? `Create encrypted backup (${PRO_LABEL})` : 'Export secrets');
  const el = this.contentEl; el.addClass('secret-parcel');
  el.createEl('p', { text: 'Select secret ids. Values stay hidden. A weak passphrase can expose secrets when the parcel is copied or synced.', cls: 'secret-parcel-warning' });
  if (this.backup) el.createEl('p', { text: `Keep the last ${this.plugin.prefs.keep} tracked backups. Older tracked backups are removed with the Obsidian deletion preference.` });
  new Setting(el).setName('Vault folder').addText(t => t.setValue(this.folder).onChange(v => this.folder = v));
  const list = el.createDiv({ cls: 'secret-parcel-list' });
  const draw = () => {
   list.empty(); const visible = filterIds(this.ids, this.prefix); this.selected = new Set([...this.selected].filter(id => visible.includes(id)));
   for (const id of visible) new Setting(list).setName(id).addToggle(t => t.setValue(this.selected.has(id)).onChange(v => { if (v) this.selected.add(id); else this.selected.delete(id); this.button?.setDisabled(!this.selected.size); }));
   if (!visible.length) list.createEl('p', { text: 'No ids match this prefix.' });
   this.button?.setDisabled(!this.selected.size);
  };
  if (isPro()) {
   new Setting(el).setName(`ID prefix (${PRO_LABEL})`).addText(t => t.setValue(this.prefix).onChange(v => { this.prefix = v; draw(); }));
   if (this.plugin.prefs.profiles.length) new Setting(el).setName(`Saved export profile (${PRO_LABEL})`).addDropdown(d => { d.addOption('', 'Choose a profile'); this.plugin.prefs.profiles.forEach((p, i) => { d.addOption(String(i), p.name); }); d.onChange(v => { if (!isPro() || v === '') return; const p = this.plugin.prefs.profiles[Number(v)]; if (p) { this.prefix = p.prefix; this.folder = p.folder; this.pass = ''; this.contentEl.empty(); this.onOpen(); } }); });
  }
  draw();
  new Setting(el).setName('Passphrase').setDesc('Use 8 or more characters. Use a long, unique passphrase.').addText(t => { t.inputEl.type = 'password'; t.inputEl.autocomplete = 'new-password'; t.onChange(v => this.pass = v); });
  new Setting(el).addButton(b => { this.button = b; b.setButtonText('Export').setCta().setDisabled(!this.selected.size).onClick(() => void this.run()); });
 }
 private async run(): Promise<void> {
  try {
   checkPassphrase(this.pass); if (this.prefix && !isPro()) throw new Error('Pro is required for prefix filters.');
   this.button?.setDisabled(true);
   const file = await this.plugin.exportSecrets([...this.selected], this.pass, this.folder, this.backup);
   if (!this.closed) { this.close(); new TextReport(this.plugin, 'Encrypted parcel created', { 'File': [file.path], 'Next step': ['Copy the encrypted parcel to the target vault. Delete the parcel after import if you do not need it.'] }).open(); }
  } catch (e) { if (!this.closed) { new Notice(message(e)); this.button?.setDisabled(!this.selected.size); } }
 }
 onClose(): void { this.pass = ''; this.selected.clear(); super.onClose(); }
}
export class ParcelPicker extends FuzzySuggestModal<TFile> {
 constructor(private plugin: SecretParcelPlugin, private files: TFile[], private comparison: boolean) { super(plugin.app); plugin.closeDialogs(); plugin.modals.add(this); }
 onClose(): void { this.plugin.modals.delete(this); super.onClose(); }
 getItems(): TFile[] { return this.files; }
 getItemText(file: TFile): string { return file.path; }
 onChooseItem(file: TFile): void { new UnlockModal(this.plugin, file, this.comparison).open(); }
}
export class UnlockModal extends ParcelModal {
 private pass = '';
 constructor(plugin: SecretParcelPlugin, private file: TFile, private comparison: boolean) { super(plugin); }
 onOpen(): void {
  this.setTitle(this.comparison ? `Compare parcel (${PRO_LABEL})` : 'Unlock parcel');
  this.contentEl.createEl('p', { text: this.file.path });
  new Setting(this.contentEl).setName('Passphrase').addText(t => { t.inputEl.type = 'password'; t.inputEl.autocomplete = 'off'; t.onChange(v => this.pass = v); });
  new Setting(this.contentEl).addButton(b => b.setButtonText(this.comparison ? 'Compare' : 'Preview import').setCta().onClick(async () => {
   b.setDisabled(true);
   try {
    if (this.comparison && this.plugin.needsPro()) return;
    const payload = await this.plugin.readParcel(this.file, this.pass); if (this.closed) return;
    if (this.comparison) { this.close(); await this.plugin.compareCurrent(payload); }
    else { this.close(); this.plugin.openPreview(payload); }
   } catch (e) { if (!this.closed) new Notice(message(e)); } finally { b.setDisabled(false); }
  }));
 }
 onClose(): void { this.pass = ''; super.onClose(); }
}
export class ImportPreview extends ParcelModal {
 private overwrites = new Set<string>();
 constructor(plugin: SecretParcelPlugin, private payload: Payload) { super(plugin); }
 onOpen(): void {
  this.setTitle('Preview import');
  const plan = preview(this.payload, this.plugin.storage);
  this.contentEl.createEl('p', { text: `${plan.newIds.length} new IDs, ${plan.conflicts.length} conflicting IDs. Conflicts are skipped unless you tick them.` });
  const list = this.contentEl.createDiv({ cls: 'secret-parcel-list' });
  for (const id of plan.newIds) new Setting(list).setName(id).setDesc('New ID. Will be written.');
  for (const id of plan.conflicts) new Setting(list).setName(id).setDesc('Conflict. Tick to overwrite this ID.').addToggle(t => t.setValue(false).onChange(v => { if (v) this.overwrites.add(id); else this.overwrites.delete(id); }));
  this.contentEl.createEl('p', { text: 'Import changes the keychain in this vault. A secret ID can be shared across vaults on mobile. Confirm the target vault before you continue.' });
  new Setting(this.contentEl).addButton(b => b.setButtonText('Confirm import').setCta().onClick(() => {
   b.setDisabled(true); const report = writePayload(this.payload, this.plugin.storage, this.overwrites); this.close(); this.plugin.showResult(report);
  }));
 }
 onClose(): void { this.payload = { entries: [] }; this.overwrites.clear(); super.onClose(); }
}
export function showReport(plugin: SecretParcelPlugin, report: Report): void { new TextReport(plugin, `${report.written.length} written, ${report.skipped.length} skipped, ${report.failed.length} failed`, { 'Written': report.written, 'Skipped': report.skipped, 'Failed': report.failed }).open(); }
export class TextReport extends ParcelModal {
 constructor(plugin: SecretParcelPlugin, private title: string, private groups: Record<string, string[]>) { super(plugin); }
 onOpen(): void { this.setTitle(this.title); for (const [title, ids] of Object.entries(this.groups)) { new Setting(this.contentEl).setName(`${title} (${ids.length})`).setHeading(); this.contentEl.createEl('p', { text: ids.length ? ids.join(', ') : 'None', cls: 'secret-parcel-ids' }); } }
}
export class ProfilesModal extends ParcelModal {
 onOpen(): void {
  this.setTitle(`Saved export profiles (${PRO_LABEL})`);
  let name = ''; let prefix = ''; let folder = this.plugin.prefs.folder;
  for (const p of this.plugin.prefs.profiles) new Setting(this.contentEl).setName(p.name).setDesc(`Prefix: ${p.prefix || '(no filter)'}; folder: ${p.folder}`).addButton(b => b.setButtonText('Export').onClick(() => { if (this.plugin.needsPro()) return; this.close(); this.plugin.openExport(false, p.prefix, p.folder); })).addButton(b => b.setButtonText('Remove').onClick(async () => { if (this.plugin.needsPro()) return; await this.plugin.removeProfile(p); if (this.closed) return; this.contentEl.empty(); this.onOpen(); }));
  new Setting(this.contentEl).setName('Profile name').addText(t => t.onChange(v => name = v));
  new Setting(this.contentEl).setName('ID prefix').addText(t => t.onChange(v => prefix = v));
  new Setting(this.contentEl).setName('Vault folder').addText(t => t.setValue(folder).onChange(v => folder = v));
  new Setting(this.contentEl).addButton(b => b.setButtonText('Save profile').onClick(async () => {
   if (this.plugin.needsPro()) return;
   try { if (!name.trim() || this.plugin.prefs.profiles.length >= 50) throw new Error('Use a profile name. The limit is 50 profiles.'); folder = folderPath(folder); this.plugin.prefs.profiles.push({ name: name.trim(), prefix, folder }); await this.plugin.saveSettings(); this.contentEl.empty(); this.onOpen(); } catch (e) { new Notice(message(e)); }
  }));
 }
}
