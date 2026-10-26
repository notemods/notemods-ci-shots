import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI } from './pro';
import type DataFormatConverterPlugin from './main';
import { helloSettingItems } from './hello/settings';

export class ConverterSettingTab extends PluginSettingTab {
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], readonly converter: DataFormatConverterPlugin) { super(app, converter); }
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: 'Conversion', desc: 'Select the source and target formats in the preview. Comments and YAML scalar styles will not be retained.' },
			...(this.converter.pro ? sponsorsSettingItems(this.converter.pro, PRO_UI) : []),
		];
	}
}
