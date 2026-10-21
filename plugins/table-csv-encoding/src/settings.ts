import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import type TableCsvEncodingPlugin from './main';
import { PRO_UI } from './pro';
import type { TableCsvOptions } from './core/index';
import { helloSettingItems } from './hello/settings';

export interface TableCsvSettings extends TableCsvOptions { outputFolder: string; batchFolder: string }
export const DEFAULT_SETTINGS: TableCsvSettings = { delimiter: ',', bom: true, headers: true, outputFolder: '', batchFolder: '' };
export function normalizeSettings(saved: Partial<TableCsvSettings> | null | undefined): TableCsvSettings {
 const s = saved ?? {};
 return {
  delimiter: s.delimiter === ';' || s.delimiter === '\t' ? s.delimiter : ',',
  bom: typeof s.bom === 'boolean' ? s.bom : true,
  headers: typeof s.headers === 'boolean' ? s.headers : true,
  outputFolder: typeof s.outputFolder === 'string' ? s.outputFolder : '',
  batchFolder: typeof s.batchFolder === 'string' ? s.batchFolder : '',
 };
}
export class TableCsvSettingTab extends PluginSettingTab {
 constructor(private owner: TableCsvEncodingPlugin) { super(owner.app, owner); }
 getSettingDefinitions(): SettingDefinitionItem[] {
 	// The product rows, then the "More from NoteMods" card (packages/hello).
 	return [...this.productSettingDefinitions(), ...helloSettingItems()];
 }

 productSettingDefinitions(): SettingDefinitionItem[] {
  return [
   { name: 'Output folder', desc: 'Use an existing vault folder. Leave empty to use the source note folder.', control: { type: 'text', key: 'outputFolder', defaultValue: '' } },
   { name: 'Folder for Pro batches', desc: 'An empty path scans the vault.', control: { type: 'text', key: 'batchFolder', defaultValue: '' } },
   ...(this.owner.pro ? sponsorsSettingItems(this.owner.pro, PRO_UI) : []),
  ];
 }
}
