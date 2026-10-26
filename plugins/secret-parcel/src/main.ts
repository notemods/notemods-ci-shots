import { Notice, Plugin, normalizePath, type Modal, type TFile } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './sponsors-adapter';
import { PRO_LABEL, SPONSORS, bindPro, isPro, resetPro, proNotice } from './pro';
import { DEFAULT_SETTINGS, SecretParcelSettingTab, normalizeSettings, type Profile, type SecretParcelSettings } from './settings';
import { checkPassphrase, encrypt, decrypt, validatePayload, folderPath, fileStamp, MAX_FILE, compare, type Report, type Payload, type Storage } from './parcel';
import { ExportModal, ParcelPicker, ProfilesModal, ImportPreview, TextReport, showReport } from './ui';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';
export default class SecretParcelPlugin extends Plugin {
 prefs: SecretParcelSettings = normalizeSettings(DEFAULT_SETTINGS);
 pro: SponsorsManager | null = null;
 readonly modals = new Set<Modal>();
 closeDialogs(): void { for (const modal of [...this.modals]) modal.close(); }
 private busy = false;
 get storage(): Storage { return this.app.secretStorage; }
 async onload(): Promise<void> {
  // First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
  setupHello(this, WHATS_NEW);
  this.prefs = normalizeSettings(await this.loadData() as Partial<SecretParcelSettings> | null);
  const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this); pro.init(); this.pro = pro; bindPro(pro);
  this.addSettingTab(new SecretParcelSettingTab(this.app, this));
  this.addCommand({ id: 'export-secrets', name: 'Export secrets', callback: () => this.openExport() });
  this.addCommand({ id: 'import-parcel', name: 'Import parcel', callback: () => this.openImport(false) });
  this.addCommand({ id: 'compare-parcel', name: `Compare parcel (${PRO_LABEL})`, callback: () => this.openImport(true) });
  this.addCommand({ id: 'backup-secrets', name: `Create encrypted backup (${PRO_LABEL})`, callback: () => this.openExport(true) });
  this.addCommand({ id: 'export-profiles', name: `Saved export profiles (${PRO_LABEL})`, callback: () => this.openProfiles() });
  this.app.workspace.onLayoutReady(() => { void pro.refresh(); this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000)); });
 }
 onunload(): void { this.closeDialogs(); resetPro(); }
 async saveSettings(): Promise<void> { await this.saveData(this.prefs); }
 needsPro(): boolean { if (isPro()) return false; proNotice('This is a pro feature.'); return true; }
 openExport(backup = false, prefix = '', folder = this.prefs.folder): void {
  if (backup && this.needsPro()) return;
  try { const ids = this.storage.listSecrets(); if (!ids.length) { new Notice('The keychain has no secrets.'); return; } new ExportModal(this, ids, backup, prefix, folder).open(); }
  catch { new Notice('Could not list secret ids.'); }
 }
 openImport(comparison = false): void {
  if (comparison && this.needsPro()) return;
  const files = this.app.vault.getFiles().filter(f => f.path.endsWith('.secretparcel.json'));
  if (!files.length) { new Notice('No parcel files found in this vault.'); return; }
  new ParcelPicker(this, files, comparison).open();
 }
 openProfiles(): void { if (!this.needsPro()) new ProfilesModal(this).open(); }
 async removeProfile(profile: Profile): Promise<void> {
  // Find the profile by identity. A second click before the redraw must not remove the next profile.
  const i = this.prefs.profiles.indexOf(profile); if (i < 0) return;
  this.prefs.profiles.splice(i, 1); await this.saveSettings();
 }
 openPreview(payload: Payload): void { new ImportPreview(this, validatePayload(payload)).open(); }
 showResult(report: Report): void { showReport(this, report); }
 async compareCurrent(payload: Payload): Promise<void> {
  if (this.needsPro()) return;
  let result: Awaited<ReturnType<typeof compare>>;
  try { result = await compare(payload, this.storage); } catch { new Notice('Could not read the current keychain.'); return; }
  if (this.needsPro()) return;
  new TextReport(this, `Parcel comparison (${PRO_LABEL})`, { 'New IDs': result.newIds, 'Missing from parcel': result.missing, 'Changed IDs': result.changed, 'Unchanged IDs': result.unchanged }).open();
 }
 async readParcel(file: TFile, pass: string): Promise<Payload> {
  if (file.stat.size > MAX_FILE) throw new Error('Parcel file exceeds 48 MB.');
  return decrypt(await this.app.vault.read(file), pass);
 }
 async exportSecrets(ids: string[], pass: string, folder: string, backup = false): Promise<TFile> {
  if (this.busy) throw new Error('An export is in progress.');
  if (backup && this.needsPro()) throw new Error('Pro is required for backups.');
  checkPassphrase(pass);
  this.busy = true;
  try {
   // Read only selected values. No plaintext is written to vault files or settings.
   const payload = validatePayload({ entries: ids.map(id => { const value = this.storage.getSecret(id); if (value === null) throw new Error(`Secret ID ${id} is no longer available.`); return { id, value }; }) });
   if (!payload.entries.length) throw new Error('Select at least one secret ID.');
   const parcel = await encrypt(payload, pass);
   const target = normalizePath(folderPath(folder));
   let parent = '';
   for (const part of target.split('/')) { parent = parent ? `${parent}/${part}` : part; if (!this.app.vault.getAbstractFileByPath(parent)) await this.app.vault.createFolder(parent); if (!this.app.vault.getFolderByPath(parent)) throw new Error('The export folder contains a file.'); }
   const base = `${target}/${backup ? 'backup' : 'secrets'}-${fileStamp(new Date())}`;
   let path = `${base}.secretparcel.json`; let n = 2;
   while (this.app.vault.getAbstractFileByPath(path)) { path = `${base}-${n++}.secretparcel.json`; }
   const file = await this.app.vault.create(path, JSON.stringify(parcel, null, 2));
   if (backup) {
    // A new backup can reuse the path of a deleted tracked backup. Track each path once and never remove the new file.
    this.prefs.backups = [...this.prefs.backups.filter(p => p !== file.path), file.path]; await this.saveSettings();
    // The new file is written. A failed removal keeps its path tracked for the next backup and does not fail this backup.
    const excess = this.prefs.backups.slice(0, Math.max(0, this.prefs.backups.length - this.prefs.keep)); const kept: string[] = [];
    for (const old of excess) {
     const oldFile = this.app.vault.getFileByPath(old);
     try { if (oldFile && oldFile !== file) await this.app.fileManager.trashFile(oldFile); } catch { kept.push(old); }
    }
    this.prefs.backups = [...kept, ...this.prefs.backups.slice(excess.length)]; await this.saveSettings();
    if (kept.length) new Notice(`Backup created. Could not remove ${kept.length} older tracked backup files. The next backup tries again.`);
   }
   return file;
  } finally { this.busy = false; }
 }
}
