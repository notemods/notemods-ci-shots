import { PluginSettingTab, Setting, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { MODES, type NumberMode } from './numbering';
import { PRO_UI, isPro } from './pro';
import type VisualLineNumbersPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface VisualLineNumbersSettings {
	/** Gutter on or off for the whole app. */
	enabled: boolean;
	mode: NumberMode;
	/** Pro. Each hidden line of a fold takes one count. */
	countFolded: boolean;
	/** Pro. Bold, accent colored number and a tinted background on the cursor row. */
	highlightCurrent: boolean;
	/** Pro. Hover text on a number with the Vim motion that reaches the row. */
	motionHint: boolean;
	/** Pro. The note property visual-line-numbers: false hides the gutter in that note. */
	noteProperty: boolean;
	/** Pro. Number colors as #rrggbb. Empty means the theme color. */
	colorAbsolute: string;
	colorRelative: string;
	colorHybrid: string;
}

export const DEFAULT_SETTINGS: VisualLineNumbersSettings = {
	enabled: true,
	mode: 'relative',
	countFolded: false,
	highlightCurrent: false,
	motionHint: false,
	noteProperty: false,
	colorAbsolute: '',
	colorRelative: '',
	colorHybrid: '',
};

const HEX = /^#[0-9a-fA-F]{6}$/;

function bool(v: unknown, fallback: boolean): boolean {
	return typeof v === 'boolean' ? v : fallback;
}

function color(v: unknown): string {
	return typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : '';
}

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<VisualLineNumbersSettings> | null | undefined): VisualLineNumbersSettings {
	const s = saved ?? {};
	return {
		enabled: bool(s.enabled, DEFAULT_SETTINGS.enabled),
		mode: MODES.includes(s.mode as NumberMode) ? (s.mode as NumberMode) : DEFAULT_SETTINGS.mode,
		countFolded: bool(s.countFolded, DEFAULT_SETTINGS.countFolded),
		highlightCurrent: bool(s.highlightCurrent, DEFAULT_SETTINGS.highlightCurrent),
		motionHint: bool(s.motionHint, DEFAULT_SETTINGS.motionHint),
		noteProperty: bool(s.noteProperty, DEFAULT_SETTINGS.noteProperty),
		colorAbsolute: color(s.colorAbsolute),
		colorRelative: color(s.colorRelative),
		colorHybrid: color(s.colorHybrid),
	};
}

/** What the editor reads. Pro choices count only while Pro is on; the saved choice stays in data.json. */
export interface EffectiveSettings {
	enabled: boolean;
	mode: NumberMode;
	countFolded: boolean;
	highlightCurrent: boolean;
	motionHint: boolean;
	noteProperty: boolean;
}

export function effectiveSettings(s: VisualLineNumbersSettings, pro: boolean): EffectiveSettings {
	return {
		enabled: s.enabled,
		mode: s.mode,
		countFolded: pro && s.countFolded,
		highlightCurrent: pro && s.highlightCurrent,
		motionHint: pro && s.motionHint,
		noteProperty: pro && s.noteProperty,
	};
}

const MODE_OPTIONS: Record<string, string> = {
	relative: 'Relative: distance from the cursor row',
	hybrid: 'Hybrid: relative, with the line number on the cursor row',
	absolute: 'Absolute: the line number on the first row of each line',
	dual: 'Dual: line numbers on the left, row distances on the right',
};

const proOff = (): boolean => !isPro();

export class VisualLineNumbersSettingTab extends PluginSettingTab {
	plugin: VisualLineNumbersPlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: VisualLineNumbersPlugin) {
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
				name: 'Show the gutter',
				desc: 'Turn the numbers on or off. Turn off "Show line numbers" in Settings, Editor, so the two gutters do not show together.',
				control: { type: 'toggle', key: 'enabled', defaultValue: DEFAULT_SETTINGS.enabled },
			},
			{
				name: 'Number mode',
				desc: 'Relative and hybrid number every display row of a wrapped line, so a count such as 5gj lands on the row that shows 5.',
				control: { type: 'dropdown', key: 'mode', defaultValue: DEFAULT_SETTINGS.mode, options: MODE_OPTIONS },
			},
			{
				type: 'group',
				heading: 'Pro options',
				items: [
					{
						name: 'Count folded lines',
						desc: 'Pro. Each line hidden in a fold takes one count, so relative numbers match the document lines. Off: a fold counts as the one row you see.',
						control: { type: 'toggle', key: 'countFolded', defaultValue: DEFAULT_SETTINGS.countFolded, disabled: proOff },
					},
					{
						name: 'Per-note property',
						desc: 'Pro. Add visual-line-numbers: false to the properties of a note to hide the gutter in that note.',
						control: { type: 'toggle', key: 'noteProperty', defaultValue: DEFAULT_SETTINGS.noteProperty, disabled: proOff },
					},
					{
						name: 'Highlight the current row',
						desc: 'Pro. Show the number of the cursor row in bold with a tinted background.',
						control: { type: 'toggle', key: 'highlightCurrent', defaultValue: DEFAULT_SETTINGS.highlightCurrent, disabled: proOff },
					},
					{
						name: 'Motion hint',
						desc: 'Pro. Hover a number to see the Vim motion that reaches the row, such as 5gj or 3gk.',
						control: { type: 'toggle', key: 'motionHint', defaultValue: DEFAULT_SETTINGS.motionHint, disabled: proOff },
					},
					{
						name: 'Absolute number color',
						desc: 'Pro. Color of the numbers in absolute mode.',
						control: { type: 'color', key: 'colorAbsolute', defaultValue: '#808080', disabled: proOff },
					},
					{
						name: 'Relative number color',
						desc: 'Pro. Color of the numbers in relative mode, and of the other rows in hybrid mode.',
						control: { type: 'color', key: 'colorRelative', defaultValue: '#808080', disabled: proOff },
					},
					{
						name: 'Hybrid cursor number color',
						desc: 'Pro. Color of the line number on the cursor row in hybrid mode.',
						control: { type: 'color', key: 'colorHybrid', defaultValue: '#808080', disabled: proOff },
					},
					{
						name: 'Reset colors',
						desc: 'Use the theme color again for all three modes.',
						render: (setting: Setting) => {
							setting.addButton((b) =>
								b.setButtonText('Reset').onClick(async () => {
									this.plugin.settings.colorAbsolute = '';
									this.plugin.settings.colorRelative = '';
									this.plugin.settings.colorHybrid = '';
									await this.plugin.saveSettings();
									this.plugin.applySettings();
									this.update();
								}),
							);
						},
					},
				],
			},
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
		this.plugin.applySettings();
	}
}
