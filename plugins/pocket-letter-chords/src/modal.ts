import { Modal, Notice, Setting, normalizePath } from 'obsidian';
import { checkFolder, exportDictionary, parseDictionary, validateBindings, type Binding } from './chords';
import { isPro } from './pro';
import type PocketLetterChordsPlugin from './main';
export class DictionaryModal extends Modal {
 constructor(readonly plugin: PocketLetterChordsPlugin, readonly index: number) { super(plugin.app); }
 onOpen(): void {
  if (this.index !== 0 && !isPro()) { this.close(); return; }
  const source = this.plugin.settings.dictionaries[this.index];
  let name = source?.name ?? 'Folder dictionary';
  let folder = source?.folder ?? '';
  let rows = JSON.stringify(source?.bindings ?? [], null, 2);
  this.setTitle(this.index === 0 ? 'Default chord dictionary' : 'Folder dictionary (Pro)');
  const el = this.contentEl;
  el.addClass('pocket-letter-chords-dictionary');
  el.createEl('p', { text: 'Enter a JSON list. Example: [{"keys":"qw","text":"Done"}]. Key order does not matter. Hold the letters together within 80 ms.' });
  if (this.index !== 0) {
   new Setting(el).setName('Name').addText(t => t.setValue(name).onChange(v => { name = v; }));
   new Setting(el).setName('Note folder').setDesc('A vault folder path, such as projects. Includes child folders.').addText(t => t.setValue(folder).onChange(v => { folder = v; }));
  }
  let area: HTMLTextAreaElement;
  new Setting(el).setClass('pocket-letter-chords-rows').setName('Chords').setDesc('Two different lowercase letters are free. Three letters need pro. Values are static text.').addTextArea(t => {
   t.setValue(rows).onChange(v => { rows = v; }); area = t.inputEl; area.setAttribute('aria-label', 'Chord rows');
  });
  const error = el.createEl('p', { cls: 'pocket-letter-chords-error', attr: { role: 'alert' } });
  const read = (): Binding[] => {
   const parsed: unknown = JSON.parse(rows);
   const bindings = validateBindings(parsed);
   if (!isPro() && bindings.some(b => b.keys.length === 3)) throw new Error('Three-letter chords need Pro.');
   return bindings;
  };
  new Setting(el).setName('Save dictionary').addButton(b => b.setButtonText('Save').setCta().onClick(async () => {
   try {
    if (this.index !== 0 && !isPro()) throw new Error('Folder dictionaries need Pro.');
    if (this.index < 0 && this.plugin.settings.dictionaries.length >= 50) throw new Error('Use up to 50 dictionaries.');
    const bindings = read();
    const path = normalizePath(folder);
    if (this.index !== 0) checkFolder(name, path);
    if (this.index !== 0 && this.plugin.settings.dictionaries.some((d,i) => i !== this.index && d.folder === path)) throw new Error('This folder already has a dictionary.');
    const dictionary = { name: this.index === 0 ? 'Default' : name.trim(), folder: this.index === 0 ? '' : path, bindings };
    if (this.index < 0) this.plugin.settings.dictionaries.push(dictionary); else this.plugin.settings.dictionaries[this.index] = dictionary;
    await this.plugin.saveSettings(); this.close(); new Notice('Dictionary saved.');
   } catch (e) { error.setText(e instanceof Error ? e.message : String(e)); }
  }));
  if (this.index > 0) new Setting(el).setName('Remove folder dictionary').addButton(b => b.setButtonText('Remove').setDisabled(!isPro()).onClick(async () => {
   if (!isPro()) return;
   this.plugin.settings.dictionaries.splice(this.index, 1); await this.plugin.saveSettings(); this.close();
  }));
  const fileHeading = 'Dictionary files (Pro)';
  new Setting(el).setName(fileHeading).setHeading();
  new Setting(el).setName('Import JSON file').setDesc('Import replaces the draft. Select save to keep it.').addButton(b => b.setButtonText('Import file').setDisabled(!isPro()).onClick(() => {
   if (!isPro()) return;
   const input = el.createEl('input', { type: 'file', cls: 'pocket-letter-chords-file' }); input.accept = '.json,application/json';
   input.addEventListener('change', () => {
    const file = input.files?.[0]; if (!file) return;
    if (file.size > 1000000) { error.setText('Dictionary file exceeds the size limit.'); input.remove(); return; }
    void file.text().then(text => {
     if (!isPro()) return;
     rows = JSON.stringify(parseDictionary(text), null, 2); area.value = rows; error.setText('Import is in the draft. Select save.');
    }).catch((e: unknown) => error.setText(e instanceof Error ? e.message : String(e))).finally(() => input.remove());
   }, { once: true }); input.click();
  }));
  new Setting(el).setName('Export JSON file').setDesc('Save the current draft as a local dictionary file.').addButton(b => b.setButtonText('Export file').setDisabled(!isPro()).onClick(() => {
   if (!isPro()) return;
   try {
    const url = URL.createObjectURL(new Blob([exportDictionary(read())], { type: 'application/json' }));
    const link = el.createEl('a', { attr: { href: url, download: 'pocket-letter-chords.json' } }); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
   } catch (e) { error.setText(e instanceof Error ? e.message : String(e)); }
  }));
 }
 onClose(): void { if (this.plugin.dictionaryModal === this) this.plugin.dictionaryModal = null; this.contentEl.empty(); }
}
