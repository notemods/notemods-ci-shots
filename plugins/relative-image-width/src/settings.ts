import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { helloSettingItems } from './hello/settings';
import { PRO_UI, isPro } from './pro';
import { defaultSize, type CssSize } from './size';
import type RelativeImageWidthPlugin from './main';

export interface RelativeImageWidthSettings {
	/** Read a Pandoc attribute block "{width=50%}" after an image link (rule 7). Off by default. */
	pandoc: boolean;
	/** Pro: the size of every embedded image that has no size in its link. Empty = off. */
	defaultSize: string;
}

/** The note property that sets the Pro default size for one note. */
export const NOTE_PROPERTY = 'image-width';

export const DEFAULT_SETTINGS: RelativeImageWidthSettings = {
	pandoc: false,
	defaultSize: '',
};

/** The options that the renderers use. Without Pro there is no default size. */
export interface Options {
	pandoc: boolean;
	/** Gives the default size for the note at this path and its note property value, or null. */
	fallback: ((property: unknown) => CssSize | null) | null;
}

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<RelativeImageWidthSettings> | null | undefined): RelativeImageWidthSettings {
	const s = saved ?? {};
	return {
		pandoc: typeof s.pandoc === 'boolean' ? s.pandoc : DEFAULT_SETTINGS.pandoc,
		defaultSize: typeof s.defaultSize === 'string' ? s.defaultSize.trim().slice(0, 40) : DEFAULT_SETTINGS.defaultSize,
	};
}

/** The settings in effect. The default size and the note property work only with Pro. */
export function effectiveOptions(settings: RelativeImageWidthSettings, pro: boolean): Options {
	return {
		pandoc: settings.pandoc,
		fallback: pro ? (property: unknown) => defaultSize(settings.defaultSize, property) : null,
	};
}

export class RelativeImageWidthSettingTab extends PluginSettingTab {
	plugin: RelativeImageWidthPlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: RelativeImageWidthPlugin) {
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
				name: 'Read Pandoc attributes',
				desc: 'Size an image from a Pandoc attribute block directly after its link, for example ![Image](image.png){width=50%}. The block also sets the id and the classes of the image. Reading view hides the block.',
				control: { type: 'toggle', key: 'pandoc', defaultValue: DEFAULT_SETTINGS.pandoc },
			},
			{
				name: 'Default image size',
				desc: `Pro. The size of every embedded image that has no size in its link, for example 100% or 40rem. Leave it empty to keep the natural size. The note property ${NOTE_PROPERTY} sets this size for one note.`,
				control: { type: 'text', key: 'defaultSize', defaultValue: DEFAULT_SETTINGS.defaultSize, placeholder: '100%', disabled: () => !isPro() },
			},
			{
				name: 'Pro features',
				desc: isPro()
					? `Pro is on: the default image size and the note property ${NOTE_PROPERTY} work.`
					: 'Free version: percent, em, rem, vw and vh sizes in image links, and Pandoc attributes. Pro adds a default size for images without a size, and a note property for one note.',
			},
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
		await this.plugin.saveSettings();
		this.plugin.refreshSoon();
	}
}
