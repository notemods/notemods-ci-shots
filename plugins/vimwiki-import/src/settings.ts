import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI } from './pro';
import type VimwikiImportPlugin from './main';
import { helloSettingItems } from './hello/settings';
export interface VimwikiImportSettings { source: string; destination: string; diary: string }
export const DEFAULT_SETTINGS: VimwikiImportSettings = { source: '', destination: 'Vimwiki notes', diary: '' };
export function normalizeSettings(saved: Partial<VimwikiImportSettings> | null | undefined): VimwikiImportSettings {
	return Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([k,v]) => [k, typeof saved?.[k as keyof VimwikiImportSettings] === 'string' ? saved[k as keyof VimwikiImportSettings] : v])) as unknown as VimwikiImportSettings;
}
export class VimwikiImportSettingTab extends PluginSettingTab {
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], public plugin: VimwikiImportPlugin) { super(app,plugin); }
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] { return this.plugin.pro ? sponsorsSettingItems(this.plugin.pro,PRO_UI) : []; }
}
