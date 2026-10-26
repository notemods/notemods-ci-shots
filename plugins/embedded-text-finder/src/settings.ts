import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI } from './pro';
import type EmbeddedTextFinderPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface Preset { name: string; folder: string; query: string }
export interface FinderSettings { folder: string; query: string; useIndex: boolean; presets: Preset[] }
export const DEFAULT_SETTINGS: FinderSettings = { folder: '', query: '', useIndex: false, presets: [] };
/** normalizePath gives '/' for the vault root. The folder list uses ''. */
export function rootAsEmpty(folder: string): string { return folder === '/' ? '' : folder; }
export function normalizeSettings(data: unknown): FinderSettings {
	const s = (data && typeof data === 'object' ? data : {}) as Partial<FinderSettings>;
	return {
		folder: typeof s.folder === 'string' ? s.folder : '',
		query: typeof s.query === 'string' ? s.query : '',
		useIndex: s.useIndex === true,
		presets: Array.isArray(s.presets) ? s.presets.filter((p) => p && typeof p.name === 'string' && typeof p.folder === 'string' && typeof p.query === 'string').slice(0, 50).map((p) => ({ ...p, folder: rootAsEmpty(p.folder) })) : [],
	};
}
export class FinderSettingTab extends PluginSettingTab {
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], private finder: EmbeddedTextFinderPlugin) { super(app, finder); }
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: 'Search scope', desc: 'Choose a folder and a literal, case-sensitive query in the search window. The search includes subfolders and follows Markdown embeds to depth two.' },
			{ name: 'Local index', desc: 'Enable the Pro index in the search window. It keeps source text in memory and invalidates changed files. Closing Obsidian clears the index.' },
			...(this.finder.pro ? sponsorsSettingItems(this.finder.pro, PRO_UI) : []),
		];
	}
}
