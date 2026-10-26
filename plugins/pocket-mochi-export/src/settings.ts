import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { DEFAULT_TAG, normalizeTag, parsePresets } from './mochi';
import { PRO_UI, isPro } from './pro';
import type PocketMochiExportPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface PocketMochiExportSettings {
	/** Lines with this tag are card fronts. */
	tag: string;
	/** Vault folder for the .mochi files. */
	folder: string;
	/** Pro: one preset for each line, name | tag | folder | deck name. */
	presets: string;
}

export const DEFAULT_FOLDER = 'Mochi exports';

export const DEFAULT_SETTINGS: PocketMochiExportSettings = {
	tag: DEFAULT_TAG,
	folder: DEFAULT_FOLDER,
	presets: '',
};

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<PocketMochiExportSettings> | null | undefined): PocketMochiExportSettings {
	const s = saved ?? {};
	const tag = typeof s.tag === 'string' ? normalizeTag(s.tag) : '';
	const folder = typeof s.folder === 'string' ? s.folder.trim().replace(/^\/+|\/+$/g, '') : '';
	return {
		tag: tag || DEFAULT_SETTINGS.tag,
		folder: folder || DEFAULT_SETTINGS.folder,
		presets: typeof s.presets === 'string' ? s.presets : DEFAULT_SETTINGS.presets,
	};
}

export class PocketMochiExportSettingTab extends PluginSettingTab {
	plugin: PocketMochiExportPlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: PocketMochiExportPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		const count = parsePresets(this.plugin.settings.presets).length;
		return [
			{
				name: 'Card tag',
				desc: 'A line with this tag is the front of a card. The lines after it, up to a line of --- or ***, are the back.',
				control: { type: 'text', key: 'tag', defaultValue: DEFAULT_SETTINGS.tag, placeholder: DEFAULT_TAG },
			},
			{
				name: 'Output folder',
				desc: 'Vault folder for the .mochi files. The plugin makes the folder if it does not exist.',
				control: { type: 'folder', key: 'folder', defaultValue: DEFAULT_SETTINGS.folder, placeholder: DEFAULT_FOLDER },
			},
			{
				name: 'Presets (Pro)',
				desc: `One preset on each line: name | tag | output folder | deck name. An empty part uses the setting above or the note name. ${count} preset${count === 1 ? '' : 's'} now.${isPro() ? '' : ' Presets need Pro.'}`,
				control: { type: 'textarea', key: 'presets', defaultValue: DEFAULT_SETTINGS.presets, placeholder: 'Biology | #bio | Mochi exports/Bio | Biology 101' },
			},
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
			{
				name: 'Pro features',
				desc: isPro()
					? 'Pro is on: folder export with one deck for each note, folder export with sub-decks, and presets.'
					: 'Free version: export the active note to a .mochi file with its images, with a preview. Pro adds folder export with one deck for each note, folder export as one deck with sub-decks, and named presets.',
			},
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
		await this.plugin.saveSettings();
	}
}
