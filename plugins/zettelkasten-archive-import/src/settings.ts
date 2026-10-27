import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { DEFAULT_RULES, normalizeRules, safeFolder, type Rules } from './model';
import { PRO_UI } from './pro';
import type Zkn3ArchiveImportPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface Zkn3ArchiveImportSettings { folder: string; rules: Rules }
export const DEFAULT_SETTINGS: Zkn3ArchiveImportSettings = { folder: 'Zettelkasten import', rules: { ...DEFAULT_RULES } };

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: unknown): Zkn3ArchiveImportSettings {
	const s = typeof saved === 'object' && saved !== null ? saved as Partial<Zkn3ArchiveImportSettings> : {};
	let folder = DEFAULT_SETTINGS.folder;
	try { if (typeof s.folder === 'string') folder = safeFolder(s.folder); } catch { /* Use the default folder. */ }
	return { folder, rules: normalizeRules(s.rules) };
}

export class Zkn3ArchiveImportSettingTab extends PluginSettingTab {
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], readonly plugin: Zkn3ArchiveImportPlugin) { super(app, plugin); }
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: 'Import folder', desc: 'Default folder for the new notes. You can change it in the import window.', control: { type: 'text', key: 'folder', defaultValue: DEFAULT_SETTINGS.folder } },
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
		];
	}
	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === 'folder' && typeof value === 'string') { try { safeFolder(value); } catch { return; } }
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
	}
}
