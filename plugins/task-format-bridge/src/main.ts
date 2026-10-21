import { MarkdownView, Modal, Notice, Plugin, Setting, normalizePath, type Editor } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { convert, MAX_CHARS, type Conversion, type Format } from './convert';
import { bindPro, isPro, onProChange, resetPro, SPONSORS } from './pro';
import { TaskFormatBridgeSettingTab } from './settings';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';
export interface FileReport { path: string; changes: number; warnings: Conversion['warnings'] }
export default class TaskFormatBridgePlugin extends Plugin {
 pro: SponsorsManager | null = null;
 private modals = new Set<Modal>();
 private unloaded = false;
 async onload(): Promise<void> {
  // First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
  setupHello(this, WHATS_NEW);
  this.unloaded = false;
  const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this); pro.init(); this.pro = pro; bindPro(pro);
  const tab = new TaskFormatBridgeSettingTab(this.app, this); this.addSettingTab(tab);
  this.register(onProChange(() => tab.update()));
  for (const target of ['emoji', 'dataview'] as const) {
   this.addCommand({ id: `preview-${target}`, name: `Preview note as ${target === 'emoji' ? 'emoji fields' : 'Dataview fields'}`, editorCallback: (editor: Editor) => { this.preview(editor, target); } });
  }
  this.addCommand({ id: 'folder-report', name: 'Open folder migration report (pro)', callback: () => {
   if (!isPro()) { new Notice('Pro adds folder migration reports. Note conversion stays free.'); return; }
   this.track(new FolderReportModal(this));
  } });
  this.app.workspace.onLayoutReady(() => {
   if (this.unloaded) return;
   void pro.refresh(); this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
  });
 }
 track(modal: Modal): void { for (const old of this.modals) old.close(); this.modals.add(modal); modal.open(); }
 forget(modal: Modal): void { this.modals.delete(modal); }
 preview(editor: Editor, target: Format): void {
  const view = this.app.workspace.getActiveViewOfType(MarkdownView);
  this.track(new ConversionModal(this, editor, view?.file?.path ?? '', target));
 }
 async scan(folder: string, target: Format): Promise<{ rows: FileReport[]; limited: boolean }> {
  if (!isPro()) throw new Error('Pro is required for folder reports.');
  folder = normalizePath(folder.trim());
  if (folder === '/') folder = '';
  const rows: FileReport[] = []; let total = 0, limited = false;
  const files = this.app.vault.getMarkdownFiles().filter((f) => !folder || f.path.startsWith(folder + '/')).sort((a, b) => a.path.localeCompare(b.path));
  for (const file of files) {
   if (!isPro() || this.unloaded) throw new Error('Report stopped.');
   if (rows.length >= 500 || total >= 5_000_000) { limited = true; break; }
   if (file.stat.size > MAX_CHARS) { rows.push({ path: file.path, changes: 0, warnings: [{ line: 1, reason: 'File exceeds the scan size limit.' }] }); continue; }
   try { const text = await this.app.vault.cachedRead(file); if (total + text.length > 5_000_000) { limited = true; break; } total += text.length; const r = convert(text, target); rows.push({ path: file.path, changes: r.changes.length, warnings: r.warnings }); }
   catch { rows.push({ path: file.path, changes: 0, warnings: [{ line: 1, reason: 'File could not be read.' }] }); }
  }
  return { rows, limited };
 }
 onunload(): void { this.unloaded = true; for (const modal of this.modals) modal.close(); this.modals.clear(); resetPro(); }
}
export class ConversionModal extends Modal {
 readonly before: string;
 readonly result: Conversion;
 constructor(readonly plugin: TaskFormatBridgePlugin, readonly editor: Editor, readonly path: string, readonly target: Format) {
  super(plugin.app); this.before = editor.getValue(); this.result = convert(this.before, target);
 }
 onOpen(): void {
  this.setTitle('Task format preview'); this.modalEl.addClass('task-format-bridge-modal');
  const el = this.contentEl;
  el.createEl('p', { text: `${this.path || 'Current note'} → ${this.target} · ${this.result.changes.length} changed lines · ${this.result.warnings.length} skipped lines`, cls: 'task-format-bridge-summary' });
  el.createEl('p', { text: 'Review the task fields below. Apply makes one editor change. Use undo in the note to reverse it.' });
  for (const c of this.result.changes.slice(0, 200)) {
   const card = el.createDiv({ cls: 'task-format-bridge-change' }); card.createEl('strong', { text: `Line ${c.line}` });
   card.createEl('pre', { text: c.before, cls: 'task-format-bridge-before' }); card.createEl('pre', { text: c.after, cls: 'task-format-bridge-after' });
  }
  if (this.result.changes.length > 200) el.createEl('p', { text: 'Preview shows the first 200 changes. The summary counts the note.' });
  for (const w of this.result.warnings.slice(0, 100)) el.createEl('p', { text: `Line ${w.line}: ${w.reason}`, cls: 'task-format-bridge-warning' });
  new Setting(el).addButton((b) => b.setButtonText('Cancel').onClick(() => this.close())).addButton((b) => b.setButtonText('Apply conversion').setCta().setDisabled(!this.result.changes.length).onClick(() => this.apply()));
 }
 apply(): void {
  const view = this.app.workspace.getActiveViewOfType(MarkdownView);
  if (!view || view.editor !== this.editor || (view.file?.path ?? '') !== this.path || this.editor.getValue() !== this.before) { new Notice('The note changed. Close this preview and open a new one.'); return; }
  this.editor.transaction({ changes: this.result.changes.map((c) => ({ from: { line: c.line - 1, ch: 0 }, to: { line: c.line - 1, ch: c.before.length }, text: c.after })) });
  new Notice(`Converted ${this.result.changes.length} task lines.`); this.close();
 }
 onClose(): void { this.contentEl.empty(); this.plugin.forget(this); }
}
export class FolderReportModal extends Modal {
 private generation = 0;
 constructor(readonly plugin: TaskFormatBridgePlugin) { super(plugin.app); }
 onOpen(): void {
  this.setTitle('Folder migration report'); this.modalEl.addClass('task-format-bridge-modal'); let folder = '', target: Format = 'dataview';
  this.contentEl.createEl('p', { text: 'Pro report. Includes up to 500 notes and 5,000,000 characters. Open a note to use its free conversion preview.' });
  const controls = this.contentEl.createDiv(); const results = this.contentEl.createDiv({ cls: 'task-format-bridge-report' }); results.setAttribute('aria-live', 'polite');
  new Setting(controls).setName('Folder').setDesc('Leave empty to scan the vault.').addText((t) => t.onChange((v) => { folder = v; }));
  new Setting(controls).setName('Target format').addDropdown((d) => d.addOption('dataview', 'Dataview').addOption('emoji', 'Emoji').onChange((v) => { target = v === 'emoji' ? 'emoji' : 'dataview'; }));
  new Setting(controls).addButton((b) => b.setButtonText('Scan folder').setCta().onClick(async () => {
   if (!isPro()) { results.setText('Pro is required for this report.'); return; }
   if (folder.split(/[\\/]/).includes('..')) { results.setText('Use a folder path inside the vault.'); return; }
   const path = folder.trim() ? normalizePath(folder.trim()) : ''; const gen = ++this.generation; const format = target; results.setText('Reading notes…'); b.setDisabled(true);
   try {
    const report = await this.plugin.scan(path, format); if (gen !== this.generation || !isPro()) return; results.empty();
    results.createEl('p', { text: `${report.rows.length} notes · ${report.rows.reduce((n, r) => n + r.changes, 0)} convertible lines · ${report.rows.reduce((n, r) => n + r.warnings.length, 0)} skipped lines${report.limited ? ' · Scan limit reached; report is incomplete.' : ''}` });
    for (const row of report.rows.filter((r) => r.changes || r.warnings.length)) {
     const card = results.createDiv({ cls: 'task-format-bridge-change' });
     const link = card.createEl('button', { text: row.path }); link.addEventListener('click', () => {
      const file = this.app.vault.getFileByPath(row.path); if (!file) { new Notice('The file no longer exists.'); return; }
      this.close(); void this.app.workspace.getLeaf(false).openFile(file);
     });
     card.createEl('p', { text: `${row.changes} convertible lines · ${row.warnings.length} skipped lines → ${format}` });
     for (const w of row.warnings.slice(0, 20)) card.createEl('p', { text: `Line ${w.line}: ${w.reason}` });
    }
   } catch { if (gen === this.generation) results.setText('The report stopped. Check pro status and try again.'); }
   finally { b.setDisabled(false); }
  }));
 }
 onClose(): void { this.generation++; this.contentEl.empty(); this.plugin.forget(this); }
}
