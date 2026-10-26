import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { DEFAULT_MAPPING, validateFolder, validateMapping, type Mapping } from './importer';
import { PRO_UI } from './pro';
import type SubstackExportImportPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface Profile { name: string; folder: string; mapping: Mapping }
export interface SubstackExportImportSettings { profiles: Profile[] }
export const DEFAULT_SETTINGS: SubstackExportImportSettings = { profiles: [] };
export function normalizeSettings(saved: unknown): SubstackExportImportSettings {
	const profiles: Profile[] = [];
	if (saved && typeof saved === 'object' && 'profiles' in saved && Array.isArray(saved.profiles)) {
		const rawProfiles: unknown[] = saved.profiles.slice(0, 30);
		for (const item of rawProfiles) {
			if (!item || typeof item !== 'object' || !('name' in item) || typeof item.name !== 'string' || !('folder' in item) || typeof item.folder !== 'string' || !('mapping' in item) || !item.mapping || typeof item.mapping !== 'object') continue;
			try {
				const mapping: Mapping = { ...DEFAULT_MAPPING, ...item.mapping };
				validateMapping(mapping); validateFolder(item.folder);
				if (item.name.trim() && item.name.length <= 80) profiles.push({ name: item.name.trim(), folder: item.folder, mapping });
			} catch { /* Drop an invalid local profile. */ }
		}
	}
	return { profiles };
}
export class SubstackExportImportSettingTab extends PluginSettingTab {
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], readonly owner: SubstackExportImportPlugin) { super(app, owner); }
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: 'Local import', desc: 'Use Import writer export from the command palette. Choose one ZIP, check its preview, then create a new folder.' },
			...(this.owner.pro ? sponsorsSettingItems(this.owner.pro, PRO_UI) : []),
			{ name: 'Saved profiles (Pro)', desc: `${this.owner.settings.profiles.length} local profiles. Save and load them in the import window. Profiles contain folder paths and property names.` },
		];
	}
}
