import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems, redrawKeepFocus } from './license/github-obsidian';
import { helloSettingItems } from './hello/settings';
import { PRO_INTERVAL, PRO_UI, isPro, proNotice } from './pro';
import { CORE_INTERVAL_MS, clampInterval, type TapAction } from './taps';
import type ReadingTapGuardPlugin from './main';

export interface ReadingTapGuardSettings {
	/** What a double tap in Reading view does (rule 1). */
	action: TapAction;
	/** Pro: the double tap interval in ms (rule 8). */
	interval: number;
}

export const ACTIONS: Record<TapAction, string> = {
	nothing: 'Do nothing',
	'select-word': 'Select the word',
	edit: 'Switch to editing (Obsidian default)',
};

export const DEFAULT_SETTINGS: ReadingTapGuardSettings = {
	action: 'nothing',
	interval: CORE_INTERVAL_MS,
};

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<ReadingTapGuardSettings> | null | undefined): ReadingTapGuardSettings {
	const s = saved ?? {};
	return {
		action: typeof s.action === 'string' && Object.prototype.hasOwnProperty.call(ACTIONS, s.action) ? s.action : DEFAULT_SETTINGS.action,
		interval: clampInterval(s.interval),
	};
}

const INTERVALS: Record<string, string> = {
	'500': '500 ms (Obsidian default)',
	'400': '400 ms',
	'300': '300 ms',
	'250': '250 ms',
	'200': '200 ms',
	'150': '150 ms',
};

export class ReadingTapGuardSettingTab extends PluginSettingTab {
	plugin: ReadingTapGuardPlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: ReadingTapGuardPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: 'Double tap in reading view',
				desc: 'What a double tap with a finger does in Reading view. The edit button and the "Toggle reading view" command always work.',
				control: { type: 'dropdown', key: 'action', defaultValue: DEFAULT_SETTINGS.action, options: { ...ACTIONS } },
			},
			{
				name: 'Double tap interval',
				desc: 'Pro. Two taps count as a double tap only when they are closer in time than this. A shorter time stops more accidental double taps. The free version uses 500 ms, the same as Obsidian.',
				control: {
					type: 'dropdown',
					key: 'intervalText',
					defaultValue: String(DEFAULT_SETTINGS.interval),
					options: { ...INTERVALS },
				},
			},
			{
				name: 'Pro features',
				desc: isPro()
					? 'Pro is on. The double tap interval setting works.'
					: 'The free version turns off the double tap, or makes it select the word or switch to editing. Pro adds a shorter double tap interval.',
			},
			// The Pro group comes after the settings of the plugin.
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
		];
	}

	getControlValue(key: string): unknown {
		// A free user sees the interval in effect: 500 ms. The stored choice stays for the time that Pro comes back.
		if (key === 'intervalText') return String(isPro() ? this.plugin.settings.interval : CORE_INTERVAL_MS);
		return super.getControlValue(key);
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === 'intervalText' && !isPro()) {
			// A free user selected the Pro interval: tell how to get Pro and save nothing. Move the focus out, then draw
			// the tab again, so the dropdown shows 500 ms (Obsidian does not draw a focused control again).
			proNotice(PRO_INTERVAL);
			redrawKeepFocus(this);
			return;
		}
		if (key === 'intervalText') {
			this.plugin.settings.interval = clampInterval(Number(value));
			await this.plugin.saveSettings();
			return;
		}
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
	}
}
