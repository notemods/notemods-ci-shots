import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI } from './pro';
import { FREE_LIMIT } from './rows';
import type { DateStyle, DoneDateMode } from './task';
import type BasesTaskRowsPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface BasesTaskRowsSettings {
	/** Style of a new date on a line that has no date yet. */
	dateStyle: DateStyle;
	/** When ticking a task adds a done date. */
	doneDate: DoneDateMode;
}

export const DEFAULT_SETTINGS: BasesTaskRowsSettings = {
	dateStyle: 'emoji',
	doneDate: 'auto',
};

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: unknown): BasesTaskRowsSettings {
	const s = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>;
	return {
		dateStyle: s.dateStyle === 'dataview' || s.dateStyle === 'emoji' ? s.dateStyle : DEFAULT_SETTINGS.dateStyle,
		doneDate: s.doneDate === 'always' || s.doneDate === 'never' || s.doneDate === 'auto' ? s.doneDate : DEFAULT_SETTINGS.doneDate,
	};
}

export class BasesTaskRowsSettingTab extends PluginSettingTab {
	plugin: BasesTaskRowsPlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: BasesTaskRowsPlugin) {
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
				name: 'Done date when you tick a task',
				desc: 'Auto adds a done date (✅ or [completion:: ]) only to lines that already carry a date, like the Tasks plugin. Unticking removes a done date unless this is never.',
				control: { type: 'dropdown', key: 'doneDate', defaultValue: DEFAULT_SETTINGS.doneDate, options: { auto: 'Auto', always: 'Always', never: 'Never' } },
			},
			{
				name: 'Format of new dates',
				desc: 'Used when a line has no date yet. A line that already has dates keeps its own format.',
				control: { type: 'dropdown', key: 'dateStyle', defaultValue: DEFAULT_SETTINGS.dateStyle, options: { emoji: 'Tasks emoji (📅 2026-10-12)', dataview: 'Dataview field ([due:: 2026-10-12])' } },
			},
			{
				name: 'Bases is turned off',
				desc: `Turn on the Bases core plugin, then reload this plugin. Without Pro a view shows the first ${FREE_LIMIT} tasks.`,
				visible: () => !this.plugin.basesReady,
			},
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
		this.plugin.refreshViews();
	}
}
