import { MarkdownView, Notice, Plugin, normalizePath, type Editor, type TFile } from 'obsidian';
import { csvFileStem, encodeTableCsv, markdownCsvTables, type TableCsvOptions } from './core/index';
import { createGitHubSponsors, guardSponsorsPro } from './license/github-obsidian';
import type { SponsorsManager } from './license/index';
import { SPONSORS } from './pro';
import { DEFAULT_SETTINGS, TableCsvSettingTab, normalizeSettings, type TableCsvSettings } from './settings';
import { ExportModal, BatchModal } from './modals';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

export interface BatchOutput { name: string; csv: string }
export interface BatchSource { file: TFile; snapshot: string; outputs: BatchOutput[] }
export interface CsvBatch { sources: BatchSource[]; options: TableCsvOptions; folder: string; skipped: string[] }
export const BATCH_SOURCE_LIMIT = 8 * 1024 * 1024;
export function vaultFolder(value: string): string {
 if (value.split(/[\\/]/).some((part) => part === '..' || part === '.')) throw new Error('Use a vault folder path without dot segments.');
 const path = normalizePath(value.trim());
 return path === '/' ? '' : path;
}

export default class TableCsvEncodingPlugin extends Plugin {
 settings: TableCsvSettings = { ...DEFAULT_SETTINGS };
 pro: SponsorsManager | null = null;
 modal: ExportModal | BatchModal | null = null;
 async onload(): Promise<void> {
   // First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
   setupHello(this, WHATS_NEW);
  await this.loadSettings();
  const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
  pro.init(); this.pro = pro;
  this.addSettingTab(new TableCsvSettingTab(this));
  this.addCommand({ id: 'export-table-csv', name: 'Export a Markdown table as CSV', editorCallback: (editor: Editor) => this.openExport(editor) });
  this.addCommand({ id: 'export-folder-csv', name: 'Export folder tables (pro)', callback: guardSponsorsPro(pro, () => this.openBatch()) });
  this.app.workspace.onLayoutReady(() => {
   void pro.refresh();
   this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
  });
 }
 onunload(): void { this.modal?.close(); this.modal = null; }
 openExport(editor: Editor): ExportModal | null {
  this.modal?.close();
  const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
  if (!file) { new Notice('Open a Markdown note first.'); return null; }
  try {
   const modal = new ExportModal(this.app, this, editor, file);
   this.modal = modal; modal.open(); return modal;
  } catch (error) { new Notice(error instanceof Error ? error.message : 'The table scan failed.'); return null; }
 }
 openBatch(): BatchModal {
  this.modal?.close(); const modal = new BatchModal(this.app, this); this.modal = modal; modal.open(); return modal;
 }
 async saveTable(editor: Editor, snapshot: string, source: TFile, index: number, stem: string, options: TableCsvOptions, expectedPath = source.path): Promise<string> {
  if (source.path !== expectedPath) throw new Error('The source note moved. Close this preview and open it again.');
  if (editor.getValue() !== snapshot) throw new Error('The note changed. Close this preview and open it again.');
  const table = markdownCsvTables(snapshot)[index];
  if (!table) throw new Error('Choose a table.');
  if (table.problem) throw new Error(table.problem);
  const folder = vaultFolder(this.settings.outputFolder || source.parent?.path || '');
  if (folder && !this.app.vault.getFolderByPath(folder)) throw new Error('The output folder does not exist.');
  const base = csvFileStem(stem);
  let path = normalizePath((folder ? folder + '/' : '') + base + '.csv');
  let serial = 2;
  while (this.app.vault.getAbstractFileByPath(path)) path = normalizePath((folder ? folder + '/' : '') + base + '-' + serial++ + '.csv');
  await this.app.vault.create(path, encodeTableCsv(table.rows, options));
  new Notice(`Saved ${path}`);
  return path;
 }
 async prepareBatch(input: string, options: TableCsvOptions, cancelled: () => boolean = () => false): Promise<CsvBatch> {
  if (!this.pro?.isPro()) throw new Error('Pro is required for a folder batch. Single-table exports are free.');
  const folder = vaultFolder(input);
  if (folder && !this.app.vault.getFolderByPath(folder)) throw new Error('The source folder does not exist.');
  const files = this.app.vault.getMarkdownFiles().filter((file) => !folder || file.path.startsWith(folder + '/')).sort((a, b) => a.path.localeCompare(b.path));
  const batch: CsvBatch = { sources: [], options: { ...options }, folder, skipped: [] };
  const names = new Set<string>();
  let characters = 0;
  for (const file of files) {
   if (cancelled()) throw new Error('Batch preparation cancelled. No files were written.');
   if (file.stat.size > 8 * 1024 * 1024) { batch.skipped.push(file.path + ': file exceeds 8 MiB.'); continue; }
   const snapshot = await this.app.vault.read(file);
   let tables;
   try { tables = markdownCsvTables(snapshot); } catch { batch.skipped.push(file.path + ': note exceeds the scan limit.'); continue; }
   if (!tables.length) continue;
   const outputs: BatchOutput[] = [];
   for (const [index, table] of tables.entries()) {
    if (table.problem) { batch.skipped.push(`${file.path}, table ${index + 1}: ${table.problem}`); continue; }
    const relative = folder ? file.path.slice(folder.length + 1) : file.path;
    const base = csvFileStem(relative.replace(/\.md$/i, '').replace(/\//g, '__') + '-table-' + (index + 1));
    let name = base + '.csv'; let serial = 2;
    while (names.has(name.toLowerCase())) name = base + '-' + serial++ + '.csv';
    names.add(name.toLowerCase());
    outputs.push({ name, csv: encodeTableCsv(table.rows, options) });
   }
   if (!outputs.length) continue;
   characters += snapshot.length;
   if (characters > BATCH_SOURCE_LIMIT) throw new Error('The batch exceeds 8,388,608 source characters. Choose a smaller folder.');
   batch.sources.push({ file, snapshot, outputs });
  }
  return batch;
 }
 async writeBatch(batch: CsvBatch): Promise<string> {
  if (!this.pro?.isPro()) throw new Error('Pro is required for a folder batch.');
  if (!batch.sources.length) throw new Error('The batch has no valid tables.');
  for (const source of batch.sources) if (await this.app.vault.read(source.file) !== source.snapshot) throw new Error('A source note changed. Prepare the batch again. No output folder was created.');
  if (!this.pro?.isPro()) throw new Error('Pro is no longer active. No output folder was created.');
  const base = 'CSV tables ' + new Date().toISOString().replace(/[:.]/g, '-');
  let folder = normalizePath(base); let serial = 2;
  while (this.app.vault.getAbstractFileByPath(folder)) folder = normalizePath(base + '-' + serial++);
  await this.app.vault.createFolder(folder);
  let written = 0;
  try {
   for (const source of batch.sources) for (const output of source.outputs) {
    await this.app.vault.create(normalizePath(folder + '/' + output.name), output.csv);
    written++;
   }
  } catch { throw new Error(`The batch stopped after ${written} files. Check ${folder}. Existing files were not overwritten.`); }
  new Notice(`Saved ${written} CSV files in ${folder}.`);
  return folder;
 }
 async loadSettings(): Promise<void> { this.settings = normalizeSettings(await this.loadData() as Partial<TableCsvSettings> | null); }
 async saveSettings(): Promise<void> { await this.saveData(this.settings); }
}
