import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { MAX_DEPTH } from './adoc/includes';
import { PRO_UI } from './pro';
import type AsciidocFilesPlugin from './main';
import { helloSettingItems } from './hello/settings';

export type ViewMode = 'preview' | 'source' | 'split';

export interface AsciidocFilesSettings {
	/** How an AsciiDoc file opens. */
	mode: ViewMode;
	/** Wait after the last key before the preview renders again, in ms. */
	delay: number;
	/** Pro: resolve include:: directives from the vault. */
	includes: boolean;
	/** Pro: include nesting limit. */
	depth: number;
	/** Pro: put the Asciidoctor default stylesheet into exported HTML files. */
	exportCss: boolean;
}

export const DELAY_MIN = 100;
export const DELAY_MAX = 2000;

export const DEFAULT_SETTINGS: AsciidocFilesSettings = {
	mode: 'preview',
	delay: 300,
	includes: true,
	depth: MAX_DEPTH,
	exportCss: true,
};

const clamp = (n: unknown, lo: number, hi: number, d: number): number => (typeof n === 'number' && Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : d);

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<AsciidocFilesSettings> | null | undefined): AsciidocFilesSettings {
	const s = saved ?? {};
	return {
		mode: s.mode === 'source' || s.mode === 'split' || s.mode === 'preview' ? s.mode : DEFAULT_SETTINGS.mode,
		delay: clamp(s.delay, DELAY_MIN, DELAY_MAX, DEFAULT_SETTINGS.delay),
		includes: typeof s.includes === 'boolean' ? s.includes : DEFAULT_SETTINGS.includes,
		depth: clamp(s.depth, 1, MAX_DEPTH, DEFAULT_SETTINGS.depth),
		exportCss: typeof s.exportCss === 'boolean' ? s.exportCss : DEFAULT_SETTINGS.exportCss,
	};
}

export class AsciidocFilesSettingTab extends PluginSettingTab {
	plugin: AsciidocFilesPlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: AsciidocFilesPlugin) {
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
				name: 'Another plugin opens AsciiDoc files',
				desc: `These extensions were already taken when the app started: ${this.plugin.blockedExtensions.join(', ')}. Turn off the other AsciiDoc plugin and restart the app.`,
				visible: () => this.plugin.blockedExtensions.length > 0,
			},
			{
				name: 'Open files in',
				desc: 'The mode of a file when you open it. The buttons in the tab header switch the mode of that tab.',
				control: { type: 'dropdown', key: 'mode', defaultValue: DEFAULT_SETTINGS.mode, options: { preview: 'Preview', source: 'Source', split: 'Source and preview side by side' } },
			},
			{
				name: 'Preview delay',
				desc: `Milliseconds to wait after the last key before the preview renders again, from ${DELAY_MIN} to ${DELAY_MAX}.`,
				control: { type: 'slider', key: 'delay', defaultValue: DEFAULT_SETTINGS.delay, min: DELAY_MIN, max: DELAY_MAX, step: 50 },
			},
			{
				name: 'Resolve include directives',
				desc: 'Pro. Shows the included files in the preview and in exports. Off, or without pro, each include shows as a short note.',
				control: { type: 'toggle', key: 'includes', defaultValue: DEFAULT_SETTINGS.includes },
			},
			{
				name: 'Include depth',
				desc: `Pro. How many levels of includes inside includes to follow, from 1 to ${MAX_DEPTH}.`,
				control: { type: 'slider', key: 'depth', defaultValue: DEFAULT_SETTINGS.depth, min: 1, max: MAX_DEPTH, step: 1 },
			},
			{
				name: 'Stylesheet in exports',
				desc: 'Pro. Puts the Asciidoctor default stylesheet into each exported HTML file. Off gives plain HTML that you can style yourself.',
				control: { type: 'toggle', key: 'exportCss', defaultValue: DEFAULT_SETTINGS.exportCss },
			},
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
		await this.plugin.saveSettings();
		this.plugin.rerenderAll();
	}
}
