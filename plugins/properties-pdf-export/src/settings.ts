import { PluginSettingTab, type App, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI, isPro } from './pro';
import type PropertiesPdfExportPlugin from './main';

export class PropertiesPdfExportSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: PropertiesPdfExportPlugin) { super(app, plugin); }
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: 'Include properties in PDF', desc: 'Add a formatted header when the note is rendered for printing.', control: { type: 'toggle', key: 'enabled', defaultValue: true } },
			{ name: 'Preview header in reading view', desc: 'Show the printable header before you export. Source text is unchanged.', control: { type: 'toggle', key: 'preview', defaultValue: false } },
			{ name: 'Header layout', control: { type: 'dropdown', key: 'layout', defaultValue: 'table', options: { table: 'Table', compact: 'Compact' } } },
			{ name: 'Hidden properties', desc: 'Defaults to cssclasses and aliases. All other fields print unless hidden. Review before sharing.', control: { type: 'text', key: 'hidden', defaultValue: 'cssclasses, aliases' } },
			{ name: 'Property order', desc: 'Comma separated names to show first. Other names keep their source order.', control: { type: 'text', key: 'order', defaultValue: '' } },
			{ name: 'Skip empty values', control: { type: 'toggle', key: 'skipEmpty', defaultValue: true } },
			{ name: 'Folder layouts', desc: 'Pro: one rule per line, such as Projects = compact. The deepest folder wins. Free uses the header layout above.', control: { type: 'textarea', key: 'folderLayouts', defaultValue: '' } },
			{ name: 'Pro offer', visible: () => !isPro(), render: setting => {
				setting.descEl.createEl('a', { text: 'Pro is $15 one time or $5 a month.', href: 'https://github.com/sponsors/theluckystrike/sponsorships?tier_id=666162&metadata_source=properties-pdf-export' });
			} },
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
		];
	}
	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		await this.plugin.saveSettings();
	}
}
