import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { ZIM_RULES, type ZimRules, type ZimSource } from './core/index';
import { PRO_UI } from './pro';
import type ZimNotebookImportPlugin from './main';
import { helloSettingItems } from './hello/settings';
export interface SavedImport { source: string; destination: string; rules: ZimRules }
export interface ImportSnapshot { source: string; destination: string; pages: ZimSource[] }
export interface ZimNotebookImportSettings { saved: SavedImport | null; snapshot: ImportSnapshot | null }
export const DEFAULT_SETTINGS: ZimNotebookImportSettings = { saved: null, snapshot: null };
export function normalizeSettings(input: unknown): ZimNotebookImportSettings {
	if (!input || typeof input !== 'object') return { ...DEFAULT_SETTINGS };
	const s = input as Partial<ZimNotebookImportSettings>;
	const saved = s.saved && typeof s.saved.source === 'string' && typeof s.saved.destination === 'string' ? {
		source: s.saved.source, destination: s.saved.destination,
		rules: { folders: s.saved.rules?.folders === 'flat' ? 'flat' as const : 'tree' as const, names: s.saved.rules?.names === 'hyphens' ? 'hyphens' as const : ZIM_RULES.names },
	} : null;
	const snapshot = s.snapshot && typeof s.snapshot.source === 'string' && typeof s.snapshot.destination === 'string' && Array.isArray(s.snapshot.pages) && s.snapshot.pages.every((p) => p && typeof p.path === 'string' && typeof p.text === 'string') ? s.snapshot : null;
	return { saved, snapshot };
}
export class ZimNotebookImportSettingTab extends PluginSettingTab {
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], readonly importer: ZimNotebookImportPlugin) { super(app, importer); }
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: 'Source files', desc: 'Use the import command to choose a folder of Zim .txt pages in this vault. The source files stay in that folder.' },
			...(this.importer.pro ? sponsorsSettingItems(this.importer.pro, PRO_UI) : []),
		];
	}
}
