import { Notice, Plugin } from 'obsidian';
import type { Extension } from '@codemirror/state';
import { createGitHubSponsors } from './license/github-obsidian';
import type { SponsorsManager } from './license/index';
import { SPONSORS } from './pro';
import { DEFAULT_SETTINGS, normalizeSettings, focusPolicy, type FocusSettings } from './policy';
import { ParagraphSpellFocusSettingTab } from './settings';
import { focusExtension } from './extension';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

export default class ParagraphSpellFocusPlugin extends Plugin {
 settings: FocusSettings = { ...DEFAULT_SETTINGS, rules: [] };
 pro: SponsorsManager | null = null;
 private extensions: Extension[] = [];
 private ready = false;
 private stopped = false;
 private tab: ParagraphSpellFocusSettingTab | null = null;
 async onload(): Promise<void> {
  // First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
  setupHello(this, WHATS_NEW);
  await this.loadSettings();
  this.pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
  this.pro.init();
  this.tab = new ParagraphSpellFocusSettingTab(this.app, this);
  this.addSettingTab(this.tab);
  this.extensions.push(focusExtension(path => focusPolicy(this.settings, path, this.pro?.isPro() ?? false), this.settings.highlight));
  this.registerEditorExtension(this.extensions);
  this.register(this.pro.onChange(() => { if (this.ready) this.refreshExtension(); this.tab?.update(); }));
  this.addCommand({ id: 'toggle-focus', name: 'Toggle paragraph spelling focus', callback: async () => {
   this.settings.enabled = !this.settings.enabled;
   await this.saveSettings();
   new Notice(this.settings.enabled ? 'Paragraph spelling focus on.' : 'Paragraph spelling focus off.');
  } });
  this.app.workspace.onLayoutReady(() => {
   if (this.stopped) return;
   this.ready = true;
   void this.pro?.refresh();
   this.registerInterval(window.setInterval(() => { void this.pro?.refresh(); }, 6 * 60 * 60 * 1000));
  });
 }
 onunload(): void { this.stopped = true; this.ready = false; }
 async loadSettings(): Promise<void> { this.settings = normalizeSettings(await this.loadData()); }
 async saveSettings(): Promise<void> {
  this.settings = normalizeSettings(this.settings);
  await this.saveData(this.settings);
  if (!this.stopped) this.refreshExtension();
 }
 refreshExtension(): void {
  this.extensions.splice(0, this.extensions.length, focusExtension(path => focusPolicy(this.settings, path, this.pro?.isPro() ?? false), this.settings.highlight));
  this.app.workspace.updateOptions();
 }
}
