import { Notice, Plugin, normalizePath, type TFile } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { check, checkSize, markdownReport, parseSchema, previewFixes, MAX_BYTES, type Result, type Preview } from './checker';
import { SPONSORS, bindPro, isPro, proNotice, resetPro } from './pro';
import { RuleSettingTab, normalizeSettings, type RuleSettings } from './settings';
import { CheckView, ChooseModal, FixModal, BatchModal, VIEW_ID } from './ui';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

export interface CheckedFile { path: string; csv: string; schema: string; result: Result }
export default class CsvSchemaLinterPlugin extends Plugin {
 settings: RuleSettings = { ruleSets: {} };
 pro: SponsorsManager | null = null;
 latest: CheckedFile[] = [];
 message = '';
 async onload(): Promise<void> {
   // First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
   setupHello(this, WHATS_NEW);
  this.settings = normalizeSettings(await this.loadData() as unknown);
  const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
  pro.init(); this.pro = pro; bindPro(pro);
  const tab = new RuleSettingTab(this.app, this);
  this.addSettingTab(tab);
  this.register(pro.onChange(() => { tab.update(); this.redraw(); }));
  this.registerView(VIEW_ID, leaf => new CheckView(leaf, this));
  this.addCommand({ id: 'check-csv', name: 'Choose CSV and check adjacent rules', callback: () => new ChooseModal(this).open() });
  this.addCommand({ id: 'write-report', name: 'Write a new Markdown report', callback: () => { void this.safe(() => this.writeReport()); } });
  this.addCommand({ id: 'preview-fixes', name: 'Preview trim and defaults (pro)', callback: () => { void this.safe(() => this.openPreview()); } });
  this.addCommand({ id: 'batch-check', name: 'Check CSV files with a saved rule set (pro)', callback: () => { if (this.requirePro()) new BatchModal(this).open(); } });
  this.app.workspace.onLayoutReady(() => { void pro.refresh(); this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000)); });
 }
 onunload(): void { resetPro(); }
 async safe(fn: () => unknown): Promise<void> {
  try { await fn(); } catch (error) { this.message = error instanceof Error ? error.message : String(error); new Notice(this.message); this.redraw(); }
 }
 requirePro(): boolean {
  if (isPro()) return true;
  proNotice('This feature needs pro. Free CSV checks and reports remain available.'); return false;
 }
 private file(path: string): TFile {
  const file = this.app.vault.getFileByPath(normalizePath(path));
  if (!file) throw new Error(`File not found: ${path}`);
  if (file.stat.size > MAX_BYTES) throw new Error(`${path} exceeds the 5 MiB limit.`);
  return file;
 }
 async readCheck(path: string, savedSchema?: string): Promise<CheckedFile> {
  const file = this.file(path);
  if (file.extension.toLowerCase() !== 'csv') throw new Error('Choose a CSV file.');
  const schema = savedSchema ?? await this.app.vault.read(this.file(`${file.path}.schema.json`));
  parseSchema(schema);
  const csv = await this.app.vault.read(file); checkSize(csv, 'CSV file');
  return { path: file.path, csv, schema, result: check(csv, schema) };
 }
 async runCheck(path: string): Promise<void> {
  const result = await this.readCheck(path);
  this.latest = [result]; this.message = ''; await this.showResults();
 }
 async runBatch(paths: string[], name: string): Promise<void> {
  if (!this.requirePro()) return;
  if (!paths.length || paths.length > 20) throw new Error('Choose 1 to 20 CSV files.');
  const schema = this.settings.ruleSets[name];
  if (!schema) throw new Error('Choose a saved rule set.');
  const results: CheckedFile[] = [];
  for (const path of paths) results.push(await this.readCheck(path, schema));
  if (!this.requirePro()) return;
  this.latest = results; this.message = ''; await this.showResults();
 }
 async showResults(): Promise<void> {
  const leaf = this.app.workspace.getLeavesOfType(VIEW_ID)[0] ?? this.app.workspace.getLeaf('tab');
  await leaf.setViewState({ type: VIEW_ID, active: true });
  this.redraw(); await this.app.workspace.revealLeaf(leaf);
 }
 redraw(): void {
  for (const leaf of this.app.workspace.getLeavesOfType(VIEW_ID)) if (leaf.view instanceof CheckView) leaf.view.render();
 }
 async createNew(base: string, extension: string, text: string): Promise<TFile> {
  for (let i = 1; i <= 10000; i++) {
   const path = normalizePath(`${base} ${i}.${extension}`);
   if (!this.app.vault.getAbstractFileByPath(path)) return this.app.vault.create(path, text);
  }
  throw new Error('No free output name.');
 }
 async writeReport(): Promise<TFile> {
  if (!this.latest.length) throw new Error('Run a CSV check first.');
  const first = this.latest[0];
  if (!first) throw new Error('No check result.');
  const text = this.latest.map(item => markdownReport(item.path, item.result)).join('\n');
  const file = await this.createNew(`${first.path} rule report`, 'md', text);
  new Notice(`Report created: ${file.path}`); return file;
 }
 async saveRuleSet(name: string): Promise<void> {
  if (!this.requirePro()) return;
  const first = this.latest[0];
  if (!first) throw new Error('Run a CSV check first.');
  if (!name.trim()) throw new Error('Enter a rule set name.');
  if (Object.prototype.hasOwnProperty.call(this.settings.ruleSets, name.trim())) throw new Error('This rule set name exists. Use a new name.');
  this.settings.ruleSets[name.trim()] = first.schema;
  await this.saveData(this.settings); new Notice('Rule set saved.');
 }
 async openPreview(): Promise<void> {
  if (!this.requirePro()) return;
  const item = this.latest[0];
  if (!item || this.latest.length !== 1) throw new Error('Check one CSV file before a fix preview.');
  new FixModal(this, item, previewFixes(item.csv, item.schema)).open();
 }
 async writeFixed(item: CheckedFile, preview: Preview): Promise<TFile | null> {
  if (!this.requirePro()) return null;
  if (await this.app.vault.read(this.file(item.path)) !== item.csv) throw new Error('The source CSV changed. Run the check again.');
  const file = await this.createNew(`${item.path.replace(/\.csv$/i, '')} fixed`, 'csv', preview.csv);
  new Notice(`New CSV created: ${file.path}`); return file;
 }
}
