import { MarkdownView, Notice, Plugin, type Editor } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { ChordEngine, chooseDictionary, normalizeSettings, type ChordSettings } from './chords';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { PocketLetterChordsSettingTab } from './settings';
import { DictionaryModal } from './modal';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

/** CodeMirror Vim sets cm-vimMode on the editor scroller outside insert mode. Letters there are commands, not text. */
function inVimCommandMode(e: KeyboardEvent): boolean {
 const target = e.target as Element | null;
 return typeof target?.closest === 'function' && target.closest('.cm-vimMode') !== null;
}
export default class PocketLetterChordsPlugin extends Plugin {
 settings: ChordSettings = normalizeSettings(null);
 pro: SponsorsManager | null = null;
 dictionaryModal: DictionaryModal | null = null;
 private engine: ChordEngine | null = null;
 private editor: Editor | null = null;
 private timer: number | null = null;
 private composing = false;
 private tab: PocketLetterChordsSettingTab | null = null;
 async onload(): Promise<void> {
  // First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
  setupHello(this, WHATS_NEW);
  await this.loadSettings();
  const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
  this.pro = pro;
  pro.init();
  bindPro(pro);
  this.tab = new PocketLetterChordsSettingTab(this.app, this);
  this.addSettingTab(this.tab);
  this.register(pro.onChange(() => { this.flushInput(); this.tab?.update(); }));
  this.registerDomEvent(document, 'keydown', e => this.keyDown(e), true);
  this.registerDomEvent(document, 'keyup', e => this.keyUp(e), true);
  this.registerDomEvent(document, 'compositionstart', () => { this.flushInput(); this.composing = true; }, true);
  this.registerDomEvent(document, 'compositionend', () => { this.composing = false; }, true);
  this.registerDomEvent(document, 'pointerdown', () => this.flushInput(), true);
  this.registerDomEvent(document, 'focusout', () => this.flushInput(), true);
  this.registerDomEvent(document, 'paste', () => this.flushInput(), true);
  this.registerDomEvent(window, 'blur', () => { this.flushInput(); this.composing = false; });
  this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.flushInput()));
  this.registerEvent(this.app.workspace.on('file-open', () => this.flushInput()));
  this.addCommand({ id: 'toggle-pause', name: 'Pause or resume chord input', callback: async () => {
   this.flushInput(); this.settings.paused = !this.settings.paused; await this.saveSettings(); this.tab?.update();
   new Notice(this.settings.paused ? 'Chord input is paused.' : 'Chord input is on.');
  }});
  this.addCommand({ id: 'edit-dictionary', name: 'Edit the chord dictionary', callback: () => this.openDictionary(0) });
  this.app.workspace.onLayoutReady(() => {
   void pro.refresh(); this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
  });
 }
 openDictionary(index: number): void {
  this.dictionaryModal?.close(); this.dictionaryModal = new DictionaryModal(this, index); this.dictionaryModal.open();
 }
 keyDown(e: KeyboardEvent): void {
  const view = this.app.workspace.getActiveViewOfType(MarkdownView);
  const editor = view?.editor;
  if (this.settings.paused || this.composing || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || !/^[a-z]$/.test(e.key) || !editor?.hasFocus() || editor.listSelections().length !== 1 || e.defaultPrevented || inVimCommandMode(e)) {
   this.flushInput(); return;
  }
  if (this.editor !== editor) this.flushInput();
  if (!this.engine) {
   this.editor = editor;
   const dictionary = chooseDictionary(this.settings, view?.file?.path ?? '', isPro());
   const bindings = dictionary.bindings.filter(b => b.keys.length === 2 || isPro());
   this.engine = new ChordEngine(bindings, text => editor.replaceSelection(text, 'pocket-letter-chords'));
  }
  if (this.engine.down(e.key, performance.now(), e.repeat)) { e.preventDefault(); e.stopImmediatePropagation(); }
  this.armTimer();
 }
 keyUp(e: KeyboardEvent): void { this.engine?.up(e.key); this.armTimer(); }
 private armTimer(): void {
  if (this.timer !== null) window.clearTimeout(this.timer);
  this.timer = null;
  if (this.engine?.waiting) this.timer = window.setTimeout(() => {
   this.timer = null; this.engine?.tick(performance.now()); this.armTimer();
  }, Math.max(1, Math.ceil(this.engine.timeLeft(performance.now()))));
 }
 flushInput(): void {
  if (this.timer !== null) window.clearTimeout(this.timer);
  this.timer = null;
  this.engine?.reset(); this.engine = null; this.editor = null;
 }
 onunload(): void { this.dictionaryModal?.close(); this.flushInput(); resetPro(); }
 async loadSettings(): Promise<void> { this.settings = normalizeSettings(await this.loadData() as unknown); }
 async saveSettings(): Promise<void> { this.flushInput(); await this.saveData(this.settings); this.tab?.update(); }
}
