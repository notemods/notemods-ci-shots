import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI, isPro } from './pro';
import type NoteWordCommentsPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface NoteWordCommentsSettings {
	/** Author name on each Word comment. */
	author: string;
	/** Pro: "Name: text" at the start of a comment sets the author of that comment. */
	authorLabels: boolean;
}

export const DEFAULT_SETTINGS: NoteWordCommentsSettings = {
	author: 'Writer',
	authorLabels: true,
};

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<NoteWordCommentsSettings> | null | undefined): NoteWordCommentsSettings {
	const s = saved ?? {};
	const author = typeof s.author === 'string' ? s.author.trim().slice(0, 80) : '';
	return {
		author: author || DEFAULT_SETTINGS.author,
		authorLabels: typeof s.authorLabels === 'boolean' ? s.authorLabels : DEFAULT_SETTINGS.authorLabels,
	};
}

export class NoteWordCommentsSettingTab extends PluginSettingTab {
	plugin: NoteWordCommentsPlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: NoteWordCommentsPlugin) {
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
				name: 'Author',
				desc: 'Name on each Word comment. The export preview can change it too.',
				control: { type: 'text', key: 'author', defaultValue: DEFAULT_SETTINGS.author },
			},
			{
				name: 'Authors from labels (Pro)',
				desc: 'A comment that starts with a name and a colon, such as "Lee: add a source", gets that name as its author.',
				control: { type: 'toggle', key: 'authorLabels', defaultValue: DEFAULT_SETTINGS.authorLabels },
			},
			{
				name: 'Pro features',
				desc: isPro()
					? 'Pro is on: join several notes, authors from labels, tables and local images.'
					: 'Free version: one note with paragraphs, headings and inline comments. Pro adds joined notes, authors from labels, tables and local images.',
			},
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
	}
}
