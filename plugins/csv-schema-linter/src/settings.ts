import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { parseSchema } from './checker';
import { PRO_UI } from './pro';
import type CsvSchemaLinterPlugin from './main';
import { helloSettingItems } from './hello/settings';
export interface RuleSettings { ruleSets: Record<string, string> }
export function normalizeSettings(saved: unknown): RuleSettings {
 const ruleSets: Record<string, string> = Object.create(null) as Record<string, string>;
 if (saved && typeof saved === 'object' && 'ruleSets' in saved && saved.ruleSets && typeof saved.ruleSets === 'object') {
  for (const [name, text] of Object.entries(saved.ruleSets)) {
   if (typeof text !== 'string' || !name.trim()) continue;
   try { parseSchema(text); ruleSets[name] = text; } catch { /* Drop invalid saved rules. */ }
  }
 }
 return { ruleSets };
}
export class RuleSettingTab extends PluginSettingTab {
 constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], private owner: CsvSchemaLinterPlugin) { super(app, owner); }
 getSettingDefinitions(): SettingDefinitionItem[] {
 	// The product rows, then the "More from NoteMods" card (packages/hello).
 	return [...this.productSettingDefinitions(), ...helloSettingItems()];
 }

 productSettingDefinitions(): SettingDefinitionItem[] {
  return [
   { name: 'Local CSV checks', desc: 'Choose a CSV file with the command palette. Rules use the adjacent filename.csv.schema.json file. The input limit is 5 MiB. Results show up to 500 errors.' },
   ...(this.owner.pro ? sponsorsSettingItems(this.owner.pro, PRO_UI) : []),
   { name: 'Saved rule sets (Pro)', desc: `${Object.keys(this.owner.settings.ruleSets).length} rule sets saved on this vault. Save a rule set from the results view.` },
  ];
 }
}
