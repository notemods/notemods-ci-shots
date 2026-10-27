import { Notice, Plugin } from 'obsidian';
import { createGitHubSponsors } from './license/github-obsidian';
import type { SponsorsManager } from './license/index';
import { compareSnapshots, planImport, validateLayout, type Layout, type Changes } from './importer';
import { SPONSORS, bindPro, isPro, proText, resetPro } from './pro';
import { ImportModal } from './modal';
import { DEFAULT_SETTINGS, ImportSettingTab, normalizeSettings, type ImportSettings } from './settings';
import { writeImport, type WriteResult } from './writer';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

export default class RemNoteJsonImportPlugin extends Plugin {
 settings: ImportSettings = { ...DEFAULT_SETTINGS, presets: [] };
 pro: SponsorsManager | null = null;
 readonly modals = new Set<ImportModal>();
 private writing = false;
 async onload(): Promise<void> {
   // First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
   setupHello(this, WHATS_NEW);
  await this.loadSettings();
  const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
  pro.init(); this.pro = pro; bindPro(pro);
  const tab = new ImportSettingTab(this.app, this); this.addSettingTab(tab);
  this.register(pro.onChange(() => { tab.update(); for (const modal of this.modals) modal.proChanged(); }));
  this.addCommand({ id: 'open-import', name: 'Import a JSON export', callback: () => this.openImport() });
  this.app.workspace.onLayoutReady(() => {
   void pro.refresh();
   this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
  });
 }
 onunload(): void { for (const modal of [...this.modals]) modal.close(); resetPro(); }
 openImport(): void { const modal = new ImportModal(this.app, this); this.modals.add(modal); modal.open(); }
 async loadSettings(): Promise<void> { this.settings = normalizeSettings(await this.loadData() as unknown); }
 async saveSettings(): Promise<void> { await this.saveData(this.settings); }
 requirePro(): void { if (!isPro()) throw new Error(proText('This is a Pro feature.')); }
 async savePreset(name: string, layout: Layout): Promise<void> {
  this.requirePro(); const options = validateLayout(layout); const label = name.trim();
  if (!label || label.length > 40) throw new Error('Use a preset name of 1 to 40 characters.');
  const presets = this.settings.presets.filter(p => p.name !== label);
  if (presets.length >= 10) throw new Error('There are 10 presets. Reuse a preset name to replace one.');
  this.settings.presets = [...presets, { name: label, layout: options }]; await this.saveSettings();
 }
 applyPreset(name: string): Layout {
  this.requirePro(); const preset = this.settings.presets.find(p => p.name === name);
  if (!preset) throw new Error('Preset not found.');
  return validateLayout(preset.layout);
 }
 previewChanges(text: string): Changes {
  this.requirePro(); if (!this.settings.snapshot) throw new Error('Import an export first to save a local snapshot.');
  return compareSnapshots(planImport(text).snapshot, this.settings.snapshot);
 }
 async importText(text: string, options: Layout): Promise<WriteResult> {
  if (options.groupRoots.length) this.requirePro();
  if (this.writing) throw new Error('An import is in progress. Wait for its report.');
  const plan = planImport(text, options); this.writing = true;
  try {
   const result = await writeImport(this.app.vault, plan);
   if (result.complete) {
    this.settings.snapshot = plan.snapshot;
    try { await this.saveSettings(); } catch { new Notice('The notes and report were written, but the comparison snapshot could not be saved.'); }
   }
   new Notice(result.complete ? `Imported ${result.written.length} notes. Read ${plan.reportPath}.` : `Import stopped after ${result.written.length} notes. ${result.error ?? 'The report is not available.'}`);
   return result;
  } finally { this.writing = false; }
 }
}
