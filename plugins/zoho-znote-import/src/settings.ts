import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI } from './pro';
import type ZohoZnoteImportPlugin from './main';
import type { Profile } from './importer';
import { helloSettingItems } from './hello/settings';

export interface ZohoZnoteImportSettings { profiles: Profile[] }
export const DEFAULT_SETTINGS: ZohoZnoteImportSettings = { profiles: [] };
export function normalizeSettings(saved: Partial<ZohoZnoteImportSettings> | null | undefined): ZohoZnoteImportSettings {
	return { profiles: Array.isArray(saved?.profiles) ? saved.profiles.filter(p => p && typeof p.name === 'string' && p.notebookFolders && p.fields) : [] };
}
export class ZohoZnoteImportSettingTab extends PluginSettingTab {
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], public plugin: ZohoZnoteImportPlugin) { super(app, plugin); }
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
			{ name: 'Local import', desc: 'Use the import command to select one native export ZIP and a new output folder.' },
			{ name: 'Saved profiles (Pro)', desc: `${this.plugin.settings.profiles.length} local profiles. Save and select profiles in the import dialog.` },
		];
	}
}
