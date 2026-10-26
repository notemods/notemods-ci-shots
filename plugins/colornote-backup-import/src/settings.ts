import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI } from './pro';
import { colorMap, validFolder, type Profile } from './backup';
import type ColornoteBackupImportPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface ColornoteBackupImportSettings { profiles: Profile[] }
export function normalizeSettings(saved: unknown): ColornoteBackupImportSettings {
	const result: Profile[] = [];
	if (saved && typeof saved === 'object' && 'profiles' in saved && Array.isArray(saved.profiles)) {
		for (const p of saved.profiles as unknown[]) {
			if (!p || typeof p !== 'object' || !('name' in p) || !('folder' in p) || !('colors' in p) || typeof p.name !== 'string' || typeof p.folder !== 'string') continue;
			try { result.push({ name: p.name.slice(0, 80), folder: validFolder(p.folder), colors: colorMap(JSON.stringify(p.colors)) }); } catch { /* Ignore invalid saved profiles. */ }
			if (result.length >= 20) break;
		}
	}
	return { profiles: result };
}
export class ColornoteBackupImportSettingTab extends PluginSettingTab {
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], private owner: ColornoteBackupImportPlugin) { super(app, owner); }
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			...(this.owner.pro ? sponsorsSettingItems(this.owner.pro, PRO_UI) : []),
			{ name: 'Local import', desc: 'Open the command palette and select Import a ColorNote backup. The backup password is kept in the modal only.' },
			{ name: 'Saved mapping profiles (Pro)', desc: `${this.owner.settings.profiles.length} profiles saved. Save or replace a profile from the import modal. Profiles contain folder paths and color labels.` },
		];
	}
}
