import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI } from './pro';
import type QueryPlugin from './main';
import { helloSettingItems } from './hello/settings';
export interface SavedQuery { name: string; path: string; expression: string }
export interface QuerySettings { saved: SavedQuery[] }
export const DEFAULT_SETTINGS: QuerySettings = { saved: [] };
export function normalizeSettings(value: unknown): QuerySettings {
	const s = value !== null && typeof value === 'object' ? (value as Partial<QuerySettings>).saved : [];
	return {
		saved: Array.isArray(s) ? s.filter((q: unknown): q is SavedQuery => {
			if (q === null || typeof q !== 'object') return false;
			const v = q as Partial<SavedQuery>;
			return typeof v.name === 'string' && !!v.name.trim() && typeof v.path === 'string' && typeof v.expression === 'string';
		}).slice(0, 100) : []
	};
}
export class QuerySettingTab extends PluginSettingTab {
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], private owner: QueryPlugin) { super(app, owner); }
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [...(this.owner.pro ? sponsorsSettingItems(this.owner.pro, PRO_UI) : []),
		{ name: 'Saved queries', desc: 'Save file and expression pairs in the query view. Up to 100 names are kept in local plugin settings.' }];
	}
}
