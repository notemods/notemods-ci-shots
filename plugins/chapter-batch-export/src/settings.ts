import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { DEFAULT_OPTIONS, type ExportOptions } from './core';
import { PRO_UI } from './pro';
import type ChapterBatchExportPlugin from './main';
import { helloSettingItems } from './hello/settings';
export interface Preset extends ExportOptions { name: string }
export interface ChapterBatchExportSettings { outputFolder: string; presets: Preset[] }
export const DEFAULT_SETTINGS: ChapterBatchExportSettings = { outputFolder: DEFAULT_OPTIONS.folder, presets: [] };
export function normalizeSettings(saved: Partial<ChapterBatchExportSettings> | null | undefined): ChapterBatchExportSettings {
	return { outputFolder: typeof saved?.outputFolder === 'string' ? saved.outputFolder : DEFAULT_OPTIONS.folder,
		presets: Array.isArray(saved?.presets) ? saved.presets.filter((p) => p && ['name', 'folder', 'range', 'heading', 'filename'].every((key) => typeof p[key as keyof Preset] === 'string')).slice(0, 50).map((p) => ({ name: p.name, folder: p.folder, range: p.range, heading: p.heading, filename: p.filename })) : [] };
}
export class ChapterBatchExportSettingTab extends PluginSettingTab {
	plugin: ChapterBatchExportPlugin;
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: ChapterBatchExportPlugin) { super(app, plugin); this.plugin = plugin; }
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [{ name: 'Output folder', desc: 'Default name for a new folder in the vault. Its parent folder must exist.', control: { type: 'text', key: 'outputFolder', defaultValue: DEFAULT_OPTIONS.folder } }, ...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : [])];
	}
}
