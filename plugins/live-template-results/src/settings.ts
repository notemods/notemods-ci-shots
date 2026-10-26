import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI } from './pro';
import type LiveTemplateResultsPlugin from './main';
import type { EnableRules } from './model';
import { helloSettingItems } from './hello/settings';

export interface LiveTemplateResultsSettings extends EnableRules { watch: string }
export const DEFAULT_SETTINGS: LiveTemplateResultsSettings = { enabled: [], disabled: [], folders: '', property: '', watch: '' };
export function normalizeSettings(value: unknown): LiveTemplateResultsSettings {
 const s = value && typeof value === 'object' ? value as Record<string, unknown> : {};
 const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
 return { enabled: strings(s.enabled), disabled: strings(s.disabled), folders: typeof s.folders === 'string' ? s.folders : '', property: typeof s.property === 'string' ? s.property : '', watch: typeof s.watch === 'string' ? s.watch : '' };
}
export class LiveTemplateResultsSettingTab extends PluginSettingTab {
 constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], public plugin: LiveTemplateResultsPlugin) { super(app, plugin); }
 getSettingDefinitions(): SettingDefinitionItem[] {
  // The product rows, then the "More from NoteMods" card (packages/hello).
  return [...this.productSettingDefinitions(), ...helloSettingItems()];
 }

 productSettingDefinitions(): SettingDefinitionItem[] {
  return [
   { name: 'Trusted notes', desc: 'Use the enable command only for notes with scripts you trust. Templater code can change files or send note data to services chosen by the script. Source edits need a refresh.' },
   ...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
   { name: 'Enable folders (Pro)', desc: 'One vault folder per line. This permits commands in that folder and its subfolders. Only add folders with trusted notes.', control: { type: 'textarea', key: 'folders', defaultValue: '' } },
   { name: 'Enable property (Pro)', desc: 'Enable a note when this property is the Boolean value true. Empty turns the rule off.', control: { type: 'text', key: 'property', defaultValue: '' } },
   { name: 'Refresh properties (Pro)', desc: 'Comma-separated property names. Refresh an open enabled note when one changes. Changes during a render do not start another refresh.', control: { type: 'text', key: 'watch', defaultValue: '' } },
  ];
 }
 async setControlValue(key: string, value: unknown): Promise<void> {
  await super.setControlValue(key, value);
  this.plugin.settings = normalizeSettings(this.plugin.settings);
  this.plugin.syncEditors();
 }
}
