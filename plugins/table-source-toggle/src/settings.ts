import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';

export interface TableSourceToggleSettings {
	prefix: string;
}

export const DEFAULT_SETTINGS: TableSourceToggleSettings = {
	prefix: 'Words: ',
};

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<TableSourceToggleSettings> | null | undefined): TableSourceToggleSettings {
	const s = saved ?? {};
	return {
		prefix: typeof s.prefix === 'string' ? s.prefix : DEFAULT_SETTINGS.prefix,
	};
}

export class TableSourceToggleSettingTab extends PluginSettingTab {
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: 'Notice prefix',
				desc: 'Text shown before the word count.',
				control: { type: 'text', key: 'prefix', defaultValue: DEFAULT_SETTINGS.prefix },
			},
		];
	}
}
