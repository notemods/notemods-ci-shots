import { Modal, Setting, Notice } from 'obsidian';
import type CardQuestionSheetPlugin from './main';
import type { Parsed } from './cards';
import { DEFAULT_PAGE, pageSettings, missingGlyphs, type PageSettings } from './pdf';
import { isPro, proLabel } from './pro';
export class PreviewModal extends Modal {
 readonly selected: Set<number>;
 page: PageSettings = { ...DEFAULT_PAGE };
 private preset = "";
 private count: HTMLElement | null = null;
 private exportButton: HTMLButtonElement | null = null;
 private error: HTMLElement | null = null;
 constructor(private tool: CardQuestionSheetPlugin, readonly parsed: Parsed, private source: string, private folder: boolean) {
  super(tool.app); this.selected = new Set(parsed.cards.map((_, i) => i));
 }
 onOpen(): void {
  this.setTitle('Card question sheet'); this.contentEl.addClass('cqs-preview');
  this.count = this.contentEl.createEl('p', { cls: 'cqs-count' });
  this.contentEl.createEl('p', { text: 'Review the question and answer of each selected card. The answer key starts on a separate page.' });
  const list = this.contentEl.createDiv({ cls: 'cqs-cards' });
  this.parsed.cards.forEach((card, index) => {
   const row = new Setting(list).setName(card.question).setDesc(`${card.answer} • ${card.source}:${card.line}`);
   row.addToggle((toggle) => { toggle.setValue(this.selected.has(index)).onChange((value) => { if (value) this.selected.add(index); else this.selected.delete(index); this.updateAccess(); }); toggle.toggleEl.setAttribute('aria-label', 'Select card ' + (index + 1)); });
  });
  if (this.parsed.unsupported.length) {
   this.contentEl.createEl('h3', { text: `${this.parsed.unsupported.length} unsupported card forms` });
   for (const item of this.parsed.unsupported) this.contentEl.createEl('p', { text: `${item.source}:${item.line} — ${item.reason}: ${item.text}`, cls: 'cqs-unsupported' });
   this.contentEl.createEl('p', { text: 'Correct the unsupported forms in the source, then open a new preview. Export is blocked.' });
  }
  const pro = this.contentEl.createDiv({ cls: 'cqs-page-settings' });
  pro.createEl('h3', { text: proLabel('Named page settings') });
  pro.createEl('p', { text: 'A4 pages. Values are in points. Pro is required to use or save these settings.' });
  if (isPro()) {
   new Setting(pro).setName(proLabel('Load page settings')).addDropdown((d) => {
    d.addOption('', 'Default'); this.tool.settings.presets.forEach((p, i) => { d.addOption(String(i), p.name); });
    d.setValue(this.preset);
    d.onChange((v) => { if (!isPro()) return; this.preset = v; this.page = v === '' ? { ...DEFAULT_PAGE } : { ...(this.tool.settings.presets[Number(v)]?.page ?? DEFAULT_PAGE) }; this.render(); });
   });
   for (const [key, name] of [['margin', 'Margins'], ['textSize', 'Text size'], ['answerSpace', 'Answer space']] as const) new Setting(pro).setName(name + ' (Pro)').addText((t) => t.setValue(String(this.page[key])).onChange((v) => { if (!isPro()) return; this.page = pageSettings({ ...this.page, [key]: v.trim() ? Number(v) : DEFAULT_PAGE[key] }); }));
   let name = '';
   new Setting(pro).setName(proLabel('Save page settings')).addText((t) => t.setPlaceholder('Example: Exam practice').onChange((v) => { name = v; })).addButton((b) => b.setButtonText('Save settings').onClick(async () => { await this.tool.savePreset(name, this.page); }));
  }
  this.error = this.contentEl.createEl('p', { cls: 'cqs-error' });
  new Setting(this.contentEl).addButton((b) => b.setButtonText('Cancel').onClick(() => this.close())).addButton((b) => {
   this.exportButton = b.buttonEl;
   b.setButtonText('Save PDF').setCta().onClick(async () => {
    this.updateAccess(); if (b.buttonEl.disabled) return;
    b.setDisabled(true);
    const cards = this.parsed.cards.filter((_, i) => this.selected.has(i));
    const file = await this.tool.saveSheet(cards, this.source, this.page, this.folder);
    if (file) this.close(); else { this.updateAccess(); this.error!.setText('The PDF was not saved. See the notice for details.'); }
   });
  });
  this.updateAccess();
 }
 private render(): void { this.contentEl.empty(); this.onOpen(); }
 updateAccess(): void {
  this.count?.setText(`${this.parsed.cards.length} ${this.parsed.cards.length === 1 ? 'card' : 'cards'} found • ${this.selected.size} selected`);
  const missing = missingGlyphs(this.parsed.cards.filter((_, i) => this.selected.has(i)).map((c) => c.question + ' ' + c.answer).join(' '));
  if (missing.length) this.error?.setText(`The bundled Noto Sans font has no glyph for ${missing.join(', ')}. No PDF can be saved with these characters.`);
  else this.error?.empty();
  if (this.exportButton) this.exportButton.disabled = !this.selected.size || !!this.parsed.unsupported.length || !!missing.length || (this.folder && !isPro());
 }
 onClose(): void { this.contentEl.empty(); if (this.tool.preview === this) this.tool.preview = null; }
}
export class FolderModal extends Modal {
 constructor(private tool: CardQuestionSheetPlugin) { super(tool.app); }
 onOpen(): void {
  this.setTitle(proLabel('Export folder')); let folder = ''; let tag = '';
  new Setting(this.contentEl).setName('Folder').setDesc('Include Markdown notes in this folder and its subfolders. Empty uses the vault root.').addText((t) => t.setPlaceholder('Study').onChange((v) => { folder = v; }));
  new Setting(this.contentEl).setName('One tag').setDesc('Exact tag match. Empty includes notes without a tag filter.').addText((t) => t.setPlaceholder('Tag name').onChange((v) => { tag = v; }));
  new Setting(this.contentEl).addButton((b) => b.setButtonText('Cancel').onClick(() => this.close())).addButton((b) => b.setButtonText('Preview cards').setCta().onClick(async () => { b.setDisabled(true); try { await this.tool.openFolder(folder, tag); this.close(); } catch (error) { new Notice(error instanceof Error ? error.message : String(error)); b.setDisabled(false); } }));
 }
 onClose(): void { this.contentEl.empty(); }
}
