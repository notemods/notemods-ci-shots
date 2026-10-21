import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { parseList } from './core/index';
import type HeadingCasePlugin from './main';

export interface HeadingCaseSettings {
	/** Comma or newline separated words and phrases kept exactly as written. */
	keepWords: string;
	/** With a selection, convert only headings on the selected lines. */
	selectionOnly: boolean;
}

export const DEFAULT_SETTINGS: HeadingCaseSettings = {
	keepWords: 'Obsidian, Markdown',
	selectionOnly: true,
};

export function normalizeSettings(saved: Partial<Record<keyof HeadingCaseSettings, unknown>> | null | undefined): HeadingCaseSettings {
	const s = saved ?? {};
	return {
		keepWords: typeof s.keepWords === 'string' ? s.keepWords : DEFAULT_SETTINGS.keepWords,
		selectionOnly: typeof s.selectionOnly === 'boolean' ? s.selectionOnly : DEFAULT_SETTINGS.selectionOnly,
	};
}

export function keepList(settings: HeadingCaseSettings): string[] {
	return parseList(settings.keepWords);
}

export class HeadingCaseSettingTab extends PluginSettingTab {
	plugin: HeadingCasePlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: HeadingCasePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: 'Words to keep',
				desc: 'Names, brands and phrases that keep the exact spelling you type here, one per line or separated by commas. Acronyms and words like iPhone are kept automatically.',
				control: { type: 'textarea', key: 'keepWords', defaultValue: DEFAULT_SETTINGS.keepWords, rows: 6, placeholder: 'New York\nGitHub\nNASA' },
			},
			{
				name: 'Selected lines only',
				desc: 'When text is selected, change only the headings on the selected lines.',
				control: { type: 'toggle', key: 'selectionOnly', defaultValue: DEFAULT_SETTINGS.selectionOnly },
			},
		];
	}
}
