import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI } from './pro';
import { cleanMapping, folderPath, type Profile } from './model';
import type WordpressWxrImportPlugin from './main';
import { helloSettingItems } from './hello/settings';
export interface WordpressWxrImportSettings { profiles: Profile[] }
export const DEFAULT_SETTINGS: WordpressWxrImportSettings = { profiles: [] };
export function normalizeSettings(saved: Partial<WordpressWxrImportSettings> | null | undefined): WordpressWxrImportSettings {
 const profiles: Profile[] = [];
 for (const value of Array.isArray(saved?.profiles) ? saved.profiles.slice(0, 30) : []) {
  try {
   if (typeof value?.name !== 'string' || !value.name.trim() || typeof value.folder !== 'string' || !value.mapping || typeof value.mapping !== 'object') continue;
   profiles.push({ name: value.name.trim().slice(0, 80), folder: folderPath(value.folder), mapping: cleanMapping(value.mapping) });
  } catch { /* Discard an invalid saved profile. */ }
 }
 return { profiles };
}
export class WordpressWxrImportSettingTab extends PluginSettingTab {
 plugin: WordpressWxrImportPlugin;
 constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: WordpressWxrImportPlugin) { super(app, plugin); this.plugin = plugin; }
 getSettingDefinitions(): SettingDefinitionItem[] {
 	// The product rows, then the "More from NoteMods" card (packages/hello).
 	return [...this.productSettingDefinitions(), ...helloSettingItems()];
 }

 productSettingDefinitions(): SettingDefinitionItem[] {
  return [
   { name: 'Import limits', desc: 'Use one UTF-8 WXR XML file up to 20 MiB and 10000 records. The import creates a new folder. Media remain links.' },
   { name: 'Saved profiles (Pro)', desc: `${this.plugin.settings.profiles.length} profiles on this device. Save or load a profile in the import window.` },
   ...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
  ];
 }
}
