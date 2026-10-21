import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI, isPro } from './pro';
import type CraftLinkRepairPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface CraftLinkRepairSettings {
	folder: string;
	outputFolder: string;
	dateFolder: string;
	dateFormat: string;
	automatic: boolean;
}
export const DEFAULT_SETTINGS: CraftLinkRepairSettings = { folder: '', outputFolder: '', dateFolder: '', dateFormat: 'YYYY-MM-DD', automatic: false };
export function normalizeSettings(saved: unknown): CraftLinkRepairSettings {
	const s = saved && typeof saved === 'object' ? saved as Partial<CraftLinkRepairSettings> : {};
	return {
		folder: typeof s.folder === 'string' ? s.folder : '',
		outputFolder: typeof s.outputFolder === 'string' ? s.outputFolder : '',
		dateFolder: typeof s.dateFolder === 'string' ? s.dateFolder : '',
		dateFormat: typeof s.dateFormat === 'string' && ['YYYY-MM-DD', 'YYYY.MM.DD', 'YYYY/MM/DD'].includes(s.dateFormat) ? s.dateFormat : 'YYYY-MM-DD',
		automatic: typeof s.automatic === 'boolean' ? s.automatic : false,
	};
}
export class CraftLinkRepairSettingTab extends PluginSettingTab {
	plugin: CraftLinkRepairPlugin;
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: CraftLinkRepairPlugin) { super(app, plugin); this.plugin = plugin; }
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: 'Export folder', desc: 'Vault path to the unpacked Craft export. The preview command also accepts this path.', control: { type: 'text', key: 'folder', defaultValue: '' } },
			{ type: 'group', heading: 'Output choices (Pro)', items: [
				{ name: 'Output folder (Pro)', desc: 'Empty creates .repaired.md copies beside source notes. A separate vault folder keeps the export folder structure.', control: { disabled: () => !isPro(), type: 'text', key: 'outputFolder', defaultValue: '' } },
				{ name: 'Date note folder (Pro)', desc: 'Vault folder for day links. The repair pass does not create date notes.', control: { disabled: () => !isPro(), type: 'text', key: 'dateFolder', defaultValue: '' } },
				{ name: 'Date format (Pro)', desc: 'Choose the file name for day links.', control: { disabled: () => !isPro(), type: 'dropdown', key: 'dateFormat', defaultValue: 'YYYY-MM-DD', options: { 'YYYY-MM-DD': 'YYYY-MM-DD', 'YYYY.MM.DD': 'YYYY.MM.DD', 'YYYY/MM/DD': 'YYYY/MM/DD' } } },
				{ name: 'Repair new exports (Pro)', desc: 'After new source files arrive, create missing copies in this export folder. Existing copies stay intact. Off by default.', control: { disabled: () => !isPro(), type: 'toggle', key: 'automatic', defaultValue: false } },
			] },
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
		];
	}
	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key !== 'folder' && !isPro()) return;
		this.plugin.settings = normalizeSettings({ ...this.plugin.settings, [key]: value });
		await this.plugin.saveSettings();
	}
}
