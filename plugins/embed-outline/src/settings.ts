import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { MAX_DEPTH } from './outline';
import { PRO_UI, isPro } from './pro';
import type EmbedOutlinePlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface EmbedOutlineSettings {
	/** Callout titles as outline rows. */
	callouts: boolean;
	/** Headings inside list items as outline rows. */
	listHeadings: boolean;
	/** Pro: levels of embeds inside embeds to open, 1 to MAX_DEPTH. */
	depth: number;
	/** Pro: word counts per heading and embed. */
	words: boolean;
	/** Pro: rows for broken embeds. */
	broken: boolean;
}

export const DEFAULT_SETTINGS: EmbedOutlineSettings = {
	callouts: true,
	listHeadings: true,
	depth: MAX_DEPTH,
	words: true,
	broken: true,
};

const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<EmbedOutlineSettings> | null | undefined): EmbedOutlineSettings {
	const s = saved ?? {};
	const depth = typeof s.depth === 'number' && Number.isFinite(s.depth) ? Math.round(s.depth) : DEFAULT_SETTINGS.depth;
	return {
		callouts: bool(s.callouts, DEFAULT_SETTINGS.callouts),
		listHeadings: bool(s.listHeadings, DEFAULT_SETTINGS.listHeadings),
		depth: Math.min(MAX_DEPTH, Math.max(1, depth)),
		words: bool(s.words, DEFAULT_SETTINGS.words),
		broken: bool(s.broken, DEFAULT_SETTINGS.broken),
	};
}

export class EmbedOutlineSettingTab extends PluginSettingTab {
	plugin: EmbedOutlinePlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: EmbedOutlinePlugin) {
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
				name: 'Callout titles',
				desc: 'Shows the title of each callout as a row, under the heading it sits in.',
				control: { type: 'toggle', key: 'callouts', defaultValue: DEFAULT_SETTINGS.callouts },
			},
			{
				name: 'Headings in list items',
				desc: 'Shows a heading written inside a list item, such as "- ## Idea", as a row. The app does not treat these as headings.',
				control: { type: 'toggle', key: 'listHeadings', defaultValue: DEFAULT_SETTINGS.listHeadings },
			},
			{
				name: 'Embed depth',
				desc: `Pro. How many levels of embeds inside embedded notes to open, from 1 to ${MAX_DEPTH}. Without Pro, the outline opens the embeds of the note itself.`,
				control: { type: 'slider', key: 'depth', defaultValue: DEFAULT_SETTINGS.depth, min: 1, max: MAX_DEPTH, step: 1 },
			},
			{
				name: 'Word counts',
				desc: 'Pro. Shows the words of each heading section and each embed, with the embedded text counted, and the total for the note.',
				control: { type: 'toggle', key: 'words', defaultValue: DEFAULT_SETTINGS.words },
			},
			{
				name: 'Broken embeds',
				desc: 'Pro. Marks embeds whose note, heading or block does not exist, and embeds that embed themselves.',
				control: { type: 'toggle', key: 'broken', defaultValue: DEFAULT_SETTINGS.broken },
			},
			{
				name: 'Pro features',
				desc: isPro()
					? 'Pro is on: nested embeds, word counts, broken embed marks and the Markdown copy of the outline.'
					: 'Free version: the headings of the note and of each note it embeds, callout titles, headings in list items, and jump on click. Pro adds nested embeds, word counts, broken embed marks and a Markdown copy of the outline.',
			},
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
		await this.plugin.saveSettings();
		this.plugin.refreshViews();
	}
}
