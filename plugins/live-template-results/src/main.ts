import { Notice, Plugin, type CachedMetadata, type TFile } from 'obsidian';
import { createGitHubSponsors } from './license/github-obsidian';
import type { SponsorsManager } from './license/index';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { DEFAULT_SETTINGS, LiveTemplateResultsSettingTab, normalizeSettings, type LiveTemplateResultsSettings } from './settings';
import { enabledFor, RenderQueue } from './model';
import { ResultsEditor, resultsExtension } from './editor';
import { PANEL, ResultsPanel } from './panel';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

export default class LiveTemplateResultsPlugin extends Plugin {
 settings: LiveTemplateResultsSettings = { ...DEFAULT_SETTINGS };
 pro: SponsorsManager | null = null;
 readonly editors = new Set<ResultsEditor>();
 readonly queue = new RenderQueue();
 private metadata = new Map<string, string>();
 async onload(): Promise<void> {
  // First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
  setupHello(this, WHATS_NEW);
  await this.loadSettings();
  const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
  pro.init(); this.pro = pro; bindPro(pro);
  const tab = new LiveTemplateResultsSettingTab(this.app, this);
  this.addSettingTab(tab);
  this.register(pro.onChange(() => { tab.update(); this.syncEditors(); }));
  this.registerEditorExtension(resultsExtension(this));
  this.registerView(PANEL, (leaf) => new ResultsPanel(leaf, this));
  this.addCommand({ id: 'enable-note', name: 'Enable template results in this trusted note', editorCallback: (_editor, info) => {
   if (info.file) void this.setEnabled(info.file.path, true);
  } });
  this.addCommand({ id: 'disable-note', name: 'Disable template results in this note', editorCallback: (_editor, info) => {
   if (info.file) void this.setEnabled(info.file.path, false);
  } });
  this.addCommand({ id: 'refresh', name: 'Refresh template results in this note', editorCallback: (_editor, info) => {
   if (info.file) void this.refreshPath(info.file.path);
  } });
  this.addCommand({ id: 'open-panel', name: 'Open template results panel', callback: () => { void this.openPanel(); } });
  this.registerEvent(this.app.metadataCache.on('changed', (file, data, cache) => this.onMetadataChanged(file, data, cache)));
  // A new path needs a new enable action. Do not transfer trust to a replacement file.
  // A manual disable moves with the note, so a rename does not let a rule enable it.
  this.registerEvent(this.app.vault.on('rename', (file, oldPath) => { void this.forget(oldPath, file.path); }));
  this.registerEvent(this.app.vault.on('delete', (file) => { void this.forget(file.path); }));
  this.app.workspace.onLayoutReady(() => {
   void pro.refresh();
   this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
  });
 }
 onMetadataChanged(file: TFile, data: string, cache: CachedMetadata): void {
  // Only the editors of this file depend on its metadata. Other files change often in large or synced vaults.
  const editors = [...this.editors].filter((editor) => editor.path === file.path);
  if (!editors.length) return;
  const stamp = this.stamp(cache);
  const previous = this.metadata.get(file.path); this.metadata.set(file.path, stamp);
  for (const editor of editors) editor.sync();
  this.drawPanels();
  if (!isPro() || !this.watchKeys().length) return;
  const changed = previous !== undefined && previous !== stamp;
  // A request waits when the editor text differs from the saved text. The next save gives new text.
  for (const editor of editors) if (changed || editor.metadataPending) editor.requestMetadataRefresh(data);
 }
 /** Records the watched values at render time, so the first later change can refresh. */
 rememberMetadata(path: string): void {
  const file = this.app.vault.getFileByPath(path);
  if (file) this.metadata.set(path, this.stamp(this.app.metadataCache.getFileCache(file)));
 }
 private watchKeys(): string[] { return this.settings.watch.split(',').map((k) => k.trim()).filter(Boolean); }
 private stamp(cache: CachedMetadata | null): string {
  return JSON.stringify(this.watchKeys().map((k) => (cache?.frontmatter?.[k] as unknown) ?? null));
 }
 async loadSettings(): Promise<void> { this.settings = normalizeSettings(await this.loadData()); }
 async saveSettings(): Promise<void> { await this.saveData(this.settings); }
 isEnabled(path: string): boolean {
  const file = this.app.vault.getFileByPath(path);
  return !!file && enabledFor(path, this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}, this.settings, isPro());
 }
 async setEnabled(path: string, enabled: boolean): Promise<void> {
  this.settings.enabled = this.settings.enabled.filter((p) => p !== path);
  this.settings.disabled = this.settings.disabled.filter((p) => p !== path);
  (enabled ? this.settings.enabled : this.settings.disabled).push(path);
  this.syncEditors();
  await this.saveSettings();
  new Notice(enabled ? 'Template results enabled for this note. Only run scripts you trust. Scripts can change files or send data to services.' : 'Template results disabled for this note.');
 }
 async refreshPath(path: string): Promise<void> {
  if (!this.isEnabled(path)) { new Notice('Enable template results in this trusted note first.'); return; }
  const editors = [...this.editors].filter((editor) => editor.path === path && editor.allowed);
  if (!editors.length) { new Notice('Use the live preview editor to refresh results.'); return; }
  await Promise.all(editors.map((editor) => editor.refresh()));
  const failed = editors.some((editor) => editor.snapshot?.results.some((r) => r.error));
  new Notice(failed ? 'No result for one or more commands. Check the inline error and Templater.' : 'Template results refreshed.');
 }
 syncEditors(): void { for (const editor of this.editors) editor.sync(); this.drawPanels(); }
 drawPanels(): void { for (const leaf of this.app.workspace.getLeavesOfType(PANEL)) if (leaf.view instanceof ResultsPanel) leaf.view.draw(); }
 private async openPanel(): Promise<void> {
  if (!isPro()) { new Notice('Pro is needed for the results panel. Results in the editor are free.'); return; }
  const leaf = this.app.workspace.getLeavesOfType(PANEL)[0] ?? this.app.workspace.getRightLeaf(false);
  if (leaf) { await leaf.setViewState({ type: PANEL, active: true }); await this.app.workspace.revealLeaf(leaf); }
 }
 private async forget(path: string, newPath?: string): Promise<void> {
  const disabled = this.settings.disabled.includes(path);
  this.settings.enabled = this.settings.enabled.filter((p) => p !== path);
  this.settings.disabled = this.settings.disabled.filter((p) => p !== path);
  if (disabled && newPath !== undefined && !this.settings.disabled.includes(newPath)) this.settings.disabled.push(newPath);
  this.metadata.delete(path); this.syncEditors(); await this.saveSettings();
 }
 onunload(): void { for (const editor of [...this.editors]) editor.destroy(); resetPro(); }
}
