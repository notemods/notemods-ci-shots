import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI } from './pro';
import type PocketMarkwhenPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface TimelineFilter { from: string; to: string; tag: string }
export interface SavedFilter extends TimelineFilter { name: string }
export interface PocketMarkwhenSettings { savedFilters: SavedFilter[] }
export const DEFAULT_SETTINGS: PocketMarkwhenSettings = { savedFilters: [] };
export function normalizeSettings(saved: Partial<PocketMarkwhenSettings> | null | undefined): PocketMarkwhenSettings {
	return { savedFilters: Array.isArray(saved?.savedFilters) ? saved.savedFilters.filter((f) => f && typeof f.name === 'string' && typeof f.from === 'string' && typeof f.to === 'string' && typeof f.tag === 'string').map((f) => ({ name: f.name.slice(0, 80), from: f.from, to: f.to, tag: f.tag })) : [] };
}
export class PocketMarkwhenSettingTab extends PluginSettingTab {
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], public plugin: PocketMarkwhenPlugin) { super(app, plugin); }
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: 'Local timelines', desc: 'Date filters stay in each open view. Named filters stay in this vault. Timeline files stay in the vault.' },
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
		];
	}
}
