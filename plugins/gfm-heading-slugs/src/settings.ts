import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { helloSettingItems } from './hello/settings';
import { PRO_UI, isPro } from './pro';
import type GfmHeadingSlugsPlugin from './main';

export interface GfmHeadingSlugsSettings {
	/** Post 1 of topic 30350 calls it useSlugsForHeadingAnchors. Off: the plugin does nothing. */
	useSlugs: boolean;
	/** Write the GitHub slug in a heading link that an edit inserts in one step. */
	rewriteInserted: boolean;
}

export const DEFAULT_SETTINGS: GfmHeadingSlugsSettings = {
	useSlugs: true,
	rewriteInserted: true,
};

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<GfmHeadingSlugsSettings> | null | undefined): GfmHeadingSlugsSettings {
	const s = saved ?? {};
	return {
		useSlugs: typeof s.useSlugs === 'boolean' ? s.useSlugs : DEFAULT_SETTINGS.useSlugs,
		rewriteInserted: typeof s.rewriteInserted === 'boolean' ? s.rewriteInserted : DEFAULT_SETTINGS.rewriteInserted,
	};
}

export class GfmHeadingSlugsSettingTab extends PluginSettingTab {
	plugin: GfmHeadingSlugsPlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: GfmHeadingSlugsPlugin) {
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
				name: 'Use GitHub slugs for heading anchors',
				desc: 'Open links like [text](#my-heading), and give each heading in Reading view its GitHub slug as id. Links in the Obsidian form keep working.',
				control: { type: 'toggle', key: 'useSlugs', defaultValue: DEFAULT_SETTINGS.useSlugs },
			},
			{
				name: 'Write slugs in inserted links',
				desc: 'When you insert a heading link in one step (link suggestions, paste or drag), write the GitHub slug in place of the heading text. Typing is not changed.',
				control: { type: 'toggle', key: 'rewriteInserted', defaultValue: DEFAULT_SETTINGS.rewriteInserted, disabled: () => !this.plugin.settings.useSlugs },
			},
			{
				name: 'Pro features',
				desc: isPro()
					? 'Pro is on: the command "Convert heading links in all notes to GitHub slugs" works.'
					: 'Free version: all features for the open note. Pro adds the command that converts the heading links of every note in the vault.',
			},
			// The Pro group comes after the settings of the plugin.
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
		this.plugin.refresh();
	}
}
