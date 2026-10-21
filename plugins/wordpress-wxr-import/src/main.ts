/* WordPress and Pro keep their product spelling in UI labels. */
/* eslint obsidianmd/ui/sentence-case: ["warn", { "brands": ["WordPress", "Pro"], "acronyms": ["XML", "WXR", "UTF", "UTF-8"] }] -- Keep product names and XML encoding spelling in UI labels. */
import { Notice, Plugin, TFile } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { WordpressWxrImportSettingTab, normalizeSettings, type WordpressWxrImportSettings } from './settings';
import { ImportModal } from './modal';
import { cleanMapping, folderPath, planImport, readSnapshot, writePlan, type Plan, type Profile } from './model';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';
export default class WordpressWxrImportPlugin extends Plugin {
 settings: WordpressWxrImportSettings = { profiles: [] };
 pro: SponsorsManager | null = null;
 private writing = false;
 private modals = new Set<ImportModal>();
 async onload(): Promise<void> {
   // First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
   setupHello(this, WHATS_NEW);
  await this.loadSettings();
  const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
  pro.init(); this.pro = pro; bindPro(pro);
  const tab = new WordpressWxrImportSettingTab(this.app, this); this.addSettingTab(tab);
  this.register(pro.onChange(() => tab.update()));
  this.addCommand({ id: 'import-wxr', name: 'Import a local WordPress XML export', callback: () => { this.openImport(); } });
  this.addCommand({ id: 'compare-wxr', name: 'Compare a later WordPress export (Pro)', callback: () => {
   if (!isPro()) { new Notice('Comparison needs Pro. Sign in with GitHub in the plugin settings.'); return; }
   this.openImport(true);
  } });
  this.app.workspace.onLayoutReady(() => {
   void pro.refresh(); this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
  });
 }
 openImport(compare = false): ImportModal {
  const modal = new ImportModal(this, compare, () => this.modals.delete(modal));
  this.modals.add(modal); modal.open(); return modal;
 }
 onunload(): void { for (const modal of this.modals) modal.close(); this.modals.clear(); resetPro(); }
 async loadSettings(): Promise<void> { this.settings = normalizeSettings(await this.loadData() as Partial<WordpressWxrImportSettings> | null); }
 async saveProfile(profile: Profile): Promise<void> {
  if (!isPro()) throw new Error('Saved profiles need Pro.');
  if (!profile.name.trim()) throw new Error('Enter a profile name.');
  const clean = { name: profile.name.trim().slice(0, 80), folder: folderPath(profile.folder), mapping: cleanMapping(profile.mapping) };
  const profiles = this.settings.profiles.filter((p) => p.name !== clean.name);
  if (profiles.length >= 30) throw new Error('The profile limit is 30. Reuse a profile name.');
  this.settings.profiles = [...profiles, clean]; await this.saveData(this.settings);
 }
 async prepare(xml: string, folder: string, mapping: Profile['mapping'] = {}, baselineFolder = ''): Promise<Plan> {
  if (!isPro() && (baselineFolder || Object.keys(mapping).length)) throw new Error('Comparison and field mapping need Pro.');
  const baseline = baselineFolder ? folderPath(baselineFolder) : '';
  if (!baseline) return planImport(xml, folder, mapping);
  const file = this.app.vault.getAbstractFileByPath(`${baseline}/_source.json`);
  if (!(file instanceof TFile)) throw new Error('The baseline folder has no _source.json snapshot.');
  if (file.stat.size > 80 * 1024 * 1024) throw new Error('The baseline snapshot exceeds 80 MiB.');
  return planImport(xml, folder, mapping, readSnapshot(await this.app.vault.read(file)));
 }
 async importXml(xml: string, folder: string, mapping: Profile['mapping'] = {}, baselineFolder = ''): Promise<Plan> {
  if (this.writing) throw new Error('An import is in progress. Wait for it to finish.');
  this.writing = true;
  try { const plan = await this.prepare(xml, folder, mapping, baselineFolder); await writePlan(this.app.vault, plan); return plan; }
  finally { this.writing = false; }
 }
}
