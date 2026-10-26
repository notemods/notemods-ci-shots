import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI } from './pro';
import type TableRowLinksPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface TableRowLinksSettings {
	/** Show the "Copy link to this table row" item in the editor context menu. */
	editorMenu: boolean;
}

export const DEFAULT_SETTINGS: TableRowLinksSettings = {
	editorMenu: true,
};

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<TableRowLinksSettings> | null | undefined): TableRowLinksSettings {
	const s = saved ?? {};
	return {
		editorMenu: typeof s.editorMenu === 'boolean' ? s.editorMenu : DEFAULT_SETTINGS.editorMenu,
	};
}

export class TableRowLinksSettingTab extends PluginSettingTab {
	plugin: TableRowLinksPlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: TableRowLinksPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
			{
				name: 'Editor context menu item',
				desc: 'Show "Copy link to this table row" when you right click inside a table.',
				control: { type: 'toggle', key: 'editorMenu', defaultValue: DEFAULT_SETTINGS.editorMenu },
			},
		];
	}
}
