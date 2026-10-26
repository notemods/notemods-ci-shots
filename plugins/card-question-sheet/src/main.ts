import { MarkdownView, Notice, Plugin, TFolder, normalizePath, getAllTags, type TFile } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { SPONSORS, bindPro, isPro, resetPro, proLabel, proNotice } from './pro';
import { parseCards, outputPath, inFolder, type Card, type Parsed } from './cards';
import { makePdf, DEFAULT_PAGE, pageSettings, type PageSettings } from './pdf';
import { PreviewModal, FolderModal } from './preview';
import { CardQuestionSheetSettingTab } from './settings';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';
export interface SavedSettings { presets: { name: string; page: PageSettings }[] }
export default class CardQuestionSheetPlugin extends Plugin {
 settings: SavedSettings = { presets: [] };
 pro: SponsorsManager | null = null;
 preview: PreviewModal | null = null;
 private saving = false;
 async onload(): Promise<void> {
   // First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
   setupHello(this, WHATS_NEW);
  const saved = await this.loadData() as Partial<SavedSettings> | null;
  this.settings = { presets: Array.isArray(saved?.presets) ? saved.presets.filter((p) => p && typeof p.name === 'string').map((p) => ({ name: p.name, page: pageSettings(p.page) })) : [] };
  const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
  pro.init(); this.pro = pro; bindPro(pro);
  const tab = new CardQuestionSheetSettingTab(this.app, this);
  this.addSettingTab(tab);
  this.register(pro.onChange(() => { tab.update(); this.preview?.updateAccess(); }));
  this.addCommand({ id: 'export-current', name: 'Export current note as a question sheet', callback: () => this.openCurrent() });
  this.addCommand({ id: 'export-folder', name: proLabel('Export folder as a question sheet'), callback: () => { if (this.requirePro()) new FolderModal(this).open(); } });
  this.app.workspace.onLayoutReady(() => { void pro.refresh(); this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000)); });
 }
 onunload(): void { this.preview?.close(); resetPro(); }
 requirePro(): boolean { if (isPro()) return true; proNotice('This feature needs pro.'); return false; }
 openCurrent(): void {
  const view = this.app.workspace.getActiveViewOfType(MarkdownView);
  if (!view?.file) { new Notice('Open a Markdown note first.'); return; }
  this.openPreview(parseCards(view.editor.getValue(), view.file.path), view.file.path);
 }
 openPreview(parsed: Parsed, source: string, folder = false): void {
  this.preview?.close(); this.preview = new PreviewModal(this, parsed, source, folder); this.preview.open();
 }
 async openFolder(folder: string, tag: string): Promise<void> {
  if (!this.requirePro()) return;
  const root = folder.trim() ? normalizePath(folder.trim()).replace(/\/$/, '') : '';
  if (root && !(this.app.vault.getAbstractFileByPath(root) instanceof TFolder)) throw new Error('The folder does not exist.');
  const filter = tag.trim().replace(/^#/, '');
  if (filter && /\s|#/.test(filter)) throw new Error('Enter one tag without spaces.');
  const parsed: Parsed = { cards: [], unsupported: [] };
  const files = this.app.vault.getMarkdownFiles().filter((f) => inFolder(f.path, root)).sort((a, b) => a.path.localeCompare(b.path));
  for (const file of files) {
   const cache = this.app.metadataCache.getFileCache(file);
   if (filter && (!cache || !(getAllTags(cache) ?? []).includes('#' + filter))) continue;
   const note = parseCards(await this.app.vault.read(file), file.path);
   parsed.cards.push(...note.cards); parsed.unsupported.push(...note.unsupported);
  }
  if (!this.requirePro()) return;
  this.openPreview(parsed, (root ? root + '/' : '') + 'Folder.md', true);
 }
 async saveSheet(cards: Card[], source: string, page: PageSettings, folder = false): Promise<TFile | null> {
  if (this.saving) return null;
  if (folder && !this.requirePro()) return null;
  this.saving = true;
  try {
   const data = await makePdf(cards, isPro() ? pageSettings(page) : DEFAULT_PAGE);
   if (folder && !this.requirePro()) return null;
   const path = outputPath(source, (p) => this.app.vault.getAbstractFileByPath(p) !== null);
   const file = await this.app.vault.createBinary(path, Uint8Array.from(data).buffer);
   new Notice(`Saved ${cards.length} cards to ${file.path}`); return file;
  } catch (error) { new Notice(error instanceof Error ? error.message : String(error)); return null; }
  finally { this.saving = false; }
 }
 async savePreset(name: string, page: PageSettings): Promise<boolean> {
  if (!this.requirePro()) return false;
  const value = name.trim(); if (!value) { new Notice('Enter a name for the page settings.'); return false; }
  const presets = this.settings.presets.filter((p) => p.name !== value);
  const next = { presets: [...presets, { name: value, page: pageSettings(page) }] };
  try { await this.saveData(next); this.settings = next; new Notice('Saved page settings.'); return true; }
  catch { new Notice('Could not save page settings.'); return false; }
 }
}
