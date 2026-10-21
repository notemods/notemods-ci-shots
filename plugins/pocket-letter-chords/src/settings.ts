import { PluginSettingTab, type SettingDefinitionItem, type SettingGroupItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI, isPro } from './pro';
import type PocketLetterChordsPlugin from './main';
import { helloSettingItems } from './hello/settings';
export class PocketLetterChordsSettingTab extends PluginSettingTab {
 constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], readonly plugin: PocketLetterChordsPlugin) { super(app, plugin); }
 getSettingDefinitions(): SettingDefinitionItem[] {
  // The product rows, then the "More from NoteMods" card (packages/hello).
  return [...this.productSettingDefinitions(), ...helloSettingItems()];
 }

 productSettingDefinitions(): SettingDefinitionItem[] {
  return [
   { name: 'Pause chord input', desc: 'Use normal keyboard input while paused.', control: { type: 'toggle', key: 'paused', defaultValue: false } },
   { name: 'Default dictionary', desc: `${this.plugin.settings.dictionaries[0]?.bindings.length ?? 0} saved chords. Lowercase ASCII letters, an 80 ms window and one cursor.`, render: s => { s.addButton(b => b.setButtonText('Edit dictionary').onClick(() => this.plugin.openDictionary(0))); } },
   { type: 'group', heading: 'Folder dictionaries (Pro)', items: [
    ...this.plugin.settings.dictionaries.slice(1).map((d, i): SettingGroupItem => ({ name: d.name, desc: `Folder: ${d.folder}. ${d.bindings.length} chords.`, render: s => { s.addButton(b => b.setButtonText('Edit dictionary').setDisabled(!isPro()).onClick(() => this.plugin.openDictionary(i + 1))); } })),
    { name: 'Add folder dictionary', desc: 'The longest matching folder path selects a dictionary. Other notes use Default.', render: s => { s.addButton(b => b.setButtonText('Add dictionary').setDisabled(!isPro()).onClick(() => this.plugin.openDictionary(-1))); } }
   ]},
   ...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : [])
  ];
 }
 async setControlValue(key: string, value: unknown): Promise<void> { this.plugin.flushInput(); await super.setControlValue(key, value); }
}
