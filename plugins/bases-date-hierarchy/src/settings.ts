import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { isPro, PRO_UI } from './pro';
import type BasesDateHierarchyPlugin from './main';

export class DateHierarchySettingTab extends PluginSettingTab {
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], public plugin: BasesDateHierarchyPlugin) { super(app, plugin); }
	getSettingDefinitions(): SettingDefinitionItem[] {
		const offer = createFragment();
		offer.append('Month and ISO week groups, collapse, counts and date order are free. Pro costs $15 one time or $5 a month. ');
		offer.createEl('a', { text: 'Get the $15 offer', href: 'https://github.com/sponsors/theluckystrike/sponsorships?tier_id=666162&metadata_source=bases-date-hierarchy' });
		return [
			{ name: 'Grouping', desc: 'Add a Date hierarchy view to a base. Choose its date property in the view options. Notes keep the sort order of the base.' },
			...(!isPro() ? [{ name: 'Optional upgrade', desc: offer }] : []),
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI).map((item) => {
				if (!('type' in item) || item.type !== 'group') return item;
				return { ...item, items: item.items?.filter((row) => !('name' in row) || row.name !== 'Get pro') };
			}) : []),
		];
	}
}
