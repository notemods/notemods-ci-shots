import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { LINE_BREAK_LABELS, isLineBreakStyle, type LineBreakStyle } from './enter';
import type ParagraphEnterPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface ParagraphEnterSettings {
	/** Enter starts a new paragraph. */
	enabled: boolean;
	/** What Shift+Enter and the Insert line break command insert. */
	lineBreakStyle: LineBreakStyle;
	/** The first start notice was shown. */
	welcomed: boolean;
}

export const DEFAULT_SETTINGS: ParagraphEnterSettings = {
	enabled: true,
	lineBreakStyle: 'newline',
	welcomed: false,
};

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<ParagraphEnterSettings> | null | undefined): ParagraphEnterSettings {
	const s = saved ?? {};
	return {
		enabled: typeof s.enabled === 'boolean' ? s.enabled : DEFAULT_SETTINGS.enabled,
		lineBreakStyle: isLineBreakStyle(s.lineBreakStyle) ? s.lineBreakStyle : DEFAULT_SETTINGS.lineBreakStyle,
		welcomed: typeof s.welcomed === 'boolean' ? s.welcomed : DEFAULT_SETTINGS.welcomed,
	};
}

export class ParagraphEnterSettingTab extends PluginSettingTab {
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], readonly owner: ParagraphEnterPlugin) { super(app, owner); }

	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: 'Enter starts a new paragraph',
				desc: 'In a plain paragraph, Enter adds a blank line and puts the cursor on the next line. Lists, quotes, callouts, tables, code, math and headings keep the default Enter.',
				control: { type: 'toggle', key: 'enabled', defaultValue: DEFAULT_SETTINGS.enabled },
			},
			{
				name: 'Line break style',
				desc: 'What Shift+Enter inserts in a paragraph. Two spaces and HTML make a visible line break in Reading view when strict line breaks are on.',
				control: { type: 'dropdown', key: 'lineBreakStyle', defaultValue: DEFAULT_SETTINGS.lineBreakStyle, options: { ...LINE_BREAK_LABELS } },
			},
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		this.owner.settings = normalizeSettings(this.owner.settings);
		this.owner.refreshStatus();
	}
}
