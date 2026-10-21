import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { isPro, PRO_UI } from './pro';
import type BasesMultiGroupPlugin from './main';

export class MultiGroupSettingTab extends PluginSettingTab {
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], public plugin: BasesMultiGroupPlugin) { super(app, plugin); }
	getSettingDefinitions(): SettingDefinitionItem[] {
		const offer = createFragment();
		offer.append('Two grouping levels, list splitting, collapse and counts are free. Pro costs $15 one time or $5 a month. ');
		offer.createEl('a', { text: 'Get the $15 offer', href: 'https://github.com/sponsors/theluckystrike/sponsorships?tier_id=666162&metadata_source=bases-multi-group' });
		return [
			{ name: 'Grouping', desc: 'Add a Multi group view to a base. Choose its properties in the view options. Notes keep the sort order of the base.' },
			...(!isPro() ? [{ name: 'Pro', desc: offer }] : []),
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
		];
	}
}
