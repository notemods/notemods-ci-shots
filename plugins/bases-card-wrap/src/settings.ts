import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { helloSettingItems } from './hello/settings';

export interface BasesCardWrapSettings {
	prefix: string;
}

export const DEFAULT_SETTINGS: BasesCardWrapSettings = {
	prefix: 'Words: ',
};

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<BasesCardWrapSettings> | null | undefined): BasesCardWrapSettings {
	const s = saved ?? {};
	return {
		prefix: typeof s.prefix === 'string' ? s.prefix : DEFAULT_SETTINGS.prefix,
	};
}

export class BasesCardWrapSettingTab extends PluginSettingTab {
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: 'Notice prefix',
				desc: 'Text shown before the word count.',
				control: { type: 'text', key: 'prefix', defaultValue: DEFAULT_SETTINGS.prefix },
			},
		];
	}
}
