import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_AUTO, PRO_OUTPUT, PRO_UI, isPro, proNotice } from './pro';
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
				{ name: 'Output folder (Pro)', desc: 'Empty creates .repaired.md copies beside source notes. A separate vault folder keeps the export folder structure.', control: { type: 'text', key: 'outputFolder', defaultValue: '' } },
				{ name: 'Date note folder (Pro)', desc: 'Vault folder for day links. The repair pass does not create date notes.', control: { type: 'text', key: 'dateFolder', defaultValue: '' } },
				{ name: 'Date format (Pro)', desc: 'Choose the file name for day links.', control: { type: 'dropdown', key: 'dateFormat', defaultValue: 'YYYY-MM-DD', options: { 'YYYY-MM-DD': 'YYYY-MM-DD', 'YYYY.MM.DD': 'YYYY.MM.DD', 'YYYY/MM/DD': 'YYYY/MM/DD' } } },
				{ name: 'Repair new exports (Pro)', desc: 'After new source files arrive, create missing copies in this export folder. Existing copies stay intact. Off by default.', control: { type: 'toggle', key: 'automatic', defaultValue: false } },
			] },
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
		];
	}
	getControlValue(key: string): unknown {
		// A free user sees the values in effect: the defaults of the Pro rows. The stored choice stays for the time that Pro comes back.
		if (key !== 'folder' && key in DEFAULT_SETTINGS && !isPro()) return DEFAULT_SETTINGS[key as keyof CraftLinkRepairSettings];
		return (this.plugin.settings as unknown as Record<string, unknown>)[key];
	}
	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key !== 'folder' && !isPro()) {
			// A free user can select the Pro rows: the notice says what needs Pro and how to get it. Nothing is saved.
			proNotice(key === 'automatic' ? PRO_AUTO : PRO_OUTPUT);
			// Obsidian does not draw a control again while it has the focus. Move the focus out, then draw the tab
			// again, so the row shows the value in effect.
			const active = this.containerEl.ownerDocument.activeElement as HTMLElement | null;
			if (active && this.containerEl.contains(active)) active.blur();
			this.update();
			return;
		}
		this.plugin.settings = normalizeSettings({ ...this.plugin.settings, [key]: value });
		await this.plugin.saveSettings();
	}
}
