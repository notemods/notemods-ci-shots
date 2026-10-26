import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { FREE_MAX_SOURCES, PRO_UI, isPro } from './pro';
import type FlattenTablePlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface FlattenTableSettings {
	/** Wait in ms after a note changes before open flat tables redraw. */
	debounceMs: number;
}

export const DEBOUNCE_MIN = 100;
export const DEBOUNCE_MAX = 2000;

export const DEFAULT_SETTINGS: FlattenTableSettings = {
	debounceMs: 300,
};

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<FlattenTableSettings> | null | undefined): FlattenTableSettings {
	const s = saved ?? {};
	const d = typeof s.debounceMs === 'number' && Number.isFinite(s.debounceMs) ? Math.round(s.debounceMs) : DEFAULT_SETTINGS.debounceMs;
	return {
		debounceMs: Math.min(DEBOUNCE_MAX, Math.max(DEBOUNCE_MIN, d)),
	};
}

export class FlattenTableSettingTab extends PluginSettingTab {
	plugin: FlattenTablePlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: FlattenTablePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
			{
				name: 'Live update delay',
				desc: `Milliseconds to wait after you edit a note before open flat tables redraw, from ${DEBOUNCE_MIN} to ${DEBOUNCE_MAX}. A longer wait means fewer redraws while you type.`,
				control: { type: 'slider', key: 'debounceMs', defaultValue: DEFAULT_SETTINGS.debounceMs, min: DEBOUNCE_MIN, max: DEBOUNCE_MAX, step: 100 },
			},
			{
				name: 'Pro features',
				desc: isPro()
					? 'Pro is on: no note limit, row filters, groups and export.'
					: `Free version: up to ${FREE_MAX_SOURCES} notes with items in one table, column sort, the source and item number columns. Pro adds no note limit, row filters, groups and export.`,
			},
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
	}
}
