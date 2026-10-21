import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI } from './pro';
import { parseRules } from './policy';
import type ParagraphSpellFocusPlugin from './main';
import { helloSettingItems } from './hello/settings';

export class ParagraphSpellFocusSettingTab extends PluginSettingTab {
 constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], public plugin: ParagraphSpellFocusPlugin) { super(app, plugin); }
 getSettingDefinitions(): SettingDefinitionItem[] {
  // The product rows, then the "More from NoteMods" card (packages/hello).
  return [...this.productSettingDefinitions(), ...helloSettingItems()];
 }

 productSettingDefinitions(): SettingDefinitionItem[] {
  const p = this.plugin;
  return [
   { name: 'Paragraph spelling focus', desc: 'Keep native spellcheck in the paragraph with the caret. Enable the native spelling option first.', control: { type: 'toggle', key: 'enabled', defaultValue: true } },
   { name: 'Mark the active range', desc: 'Use a subtle background for the paragraph or section being edited.', control: { type: 'toggle', key: 'highlight', defaultValue: true } },
   { name: 'Focus scope (Pro)', desc: 'Section uses the nearest heading and stops at the next heading of the same or a higher level.', control: { type: 'dropdown', key: 'scope', defaultValue: 'paragraph', options: { paragraph: 'Paragraph', section: 'Section' }, disabled: () => !(p.pro?.isPro() ?? false) } },
   { name: 'Folder rules (Pro)', desc: 'One rule per line: Drafts=section, Notes=paragraph, or Code=off. The most specific folder wins. Off restores normal native spelling in that folder.', render: s => {
    s.addTextArea(area => area.setValue(p.settings.rules.map(r => `${r.folder}=${r.scope}`).join('\n')).setPlaceholder('Drafts=section').setDisabled(!(p.pro?.isPro() ?? false)).onChange(async value => {
     if (!p.pro?.isPro()) return;
     p.settings.rules = parseRules(value);
     await p.saveSettings();
    }));
   } },
   ...(p.pro ? sponsorsSettingItems(p.pro, PRO_UI) : []),
  ];
 }
 async setControlValue(key: string, value: unknown): Promise<void> {
  if ((key === 'scope' || key === 'rules') && !this.plugin.pro?.isPro()) return;
  await super.setControlValue(key, value);
  await this.plugin.saveSettings();
 }
}
