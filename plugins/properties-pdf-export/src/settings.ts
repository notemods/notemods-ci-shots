import { PluginSettingTab, type App, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_FOLDERS, PRO_UI, isPro, proNotice } from './pro';
import type PropertiesPdfExportPlugin from './main';
import { helloSettingItems } from './hello/settings';

export class PropertiesPdfExportSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: PropertiesPdfExportPlugin) { super(app, plugin); }
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
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
	getControlValue(key: string): unknown {
		// A free user sees the value in effect: no folder rules. The saved rules stay in data.json for the time that Pro comes back.
		if (key === 'folderLayouts' && !isPro()) return '';
		return super.getControlValue(key);
	}
	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === 'folderLayouts' && !isPro()) {
			// A free user can edit the row: the notice says what needs Pro and how to get it. Nothing is saved.
			proNotice(PRO_FOLDERS);
			// Obsidian does not draw a control again while it has the focus. Move the focus out, then draw the tab
			// again, so the field shows the value in effect (no rules).
			const active = this.containerEl.ownerDocument.activeElement as HTMLElement | null;
			if (active && this.containerEl.contains(active)) active.blur();
			this.update();
			return;
		}
		await super.setControlValue(key, value);
		await this.plugin.saveSettings();
	}
}
