import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { ISO_FORMAT, validFormat, validZone } from './converter';
import { isPro, PRO_UI } from './pro';
import type EpochNoteConverterPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface EpochNoteConverterSettings {
	zones: string;
	format: string;
}
export const DEFAULT_SETTINGS: EpochNoteConverterSettings = { zones: 'UTC, Asia/Bangkok, America/New_York', format: ISO_FORMAT };

export function normalizeSettings(saved: Partial<EpochNoteConverterSettings> | null | undefined): EpochNoteConverterSettings {
	return {
		zones: typeof saved?.zones === 'string' ? saved.zones.split(',').map((s) => s.trim()).filter(validZone).filter((s, i, list) => list.indexOf(s) === i).slice(0, 6).join(', ') : DEFAULT_SETTINGS.zones,
		format: typeof saved?.format === 'string' && validFormat(saved.format) ? saved.format : ISO_FORMAT,
	};
}

export class EpochNoteConverterSettingTab extends PluginSettingTab {
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], readonly owner: EpochNoteConverterPlugin) {
		super(app, owner);
	}
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			...(this.owner.pro ? sponsorsSettingItems(this.owner.pro, PRO_UI) : []),
			{ name: PRO_UI.zoneHeading, desc: 'Comma-separated IANA names, up to six. Unsupported names are removed when saved.', control: { disabled: () => !isPro(), type: 'text', key: 'zones', defaultValue: DEFAULT_SETTINGS.zones } },
			{ name: 'Saved output format (Pro)', desc: 'Use {date}, {time} and {offset} once each. Example: {date} {time} {offset}. Invalid formats return to ISO.', control: { disabled: () => !isPro(), type: 'text', key: 'format', defaultValue: ISO_FORMAT } },
		];
	}
	async setControlValue(key: string, value: unknown): Promise<void> {
		if (!isPro()) return;
		this.owner.settings = normalizeSettings({ ...this.owner.settings, [key]: value });
		await this.owner.saveSettings();
	}
}
