import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI } from './pro';
import type TaskFormatBridgePlugin from './main';
import { helloSettingItems } from './hello/settings';
export class TaskFormatBridgeSettingTab extends PluginSettingTab {
 constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], readonly plugin: TaskFormatBridgePlugin) { super(app, plugin); }
 getSettingDefinitions(): SettingDefinitionItem[] {
  // The product rows, then the "More from NoteMods" card (packages/hello).
  return [...this.productSettingDefinitions(), ...helloSettingItems()];
 }

 productSettingDefinitions(): SettingDefinitionItem[] {
  return [
   { name: 'Preview before conversion', desc: 'Choose a target from the command palette. Review the before and after text. Changed source text makes a preview expire.' },
   ...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
  ];
 }
}
