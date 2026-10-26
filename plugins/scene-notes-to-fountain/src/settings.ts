import { PluginSettingTab, type Setting, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { DEFAULT_MAPPING } from './fountain';
import { PRO_UI, isPro } from './pro';
import type SceneNotesToFountainPlugin from './main';
import { helloSettingItems } from './hello/settings';

/** A saved selection: notes of one folder in a set order (Pro). */
export interface NoteGroup {
	name: string;
	folder: string;
	paths: string[];
}

export interface SceneNotesToFountainSettings {
	/** Property names (Pro). Without Pro the plugin reads "slugline" and "synopsis". */
	sluglineProperty: string;
	synopsisProperty: string;
	/** Output folder (Pro). Empty = the folder of the notes. */
	outputFolder: string;
	/** Output file name without .fountain (Pro). */
	fileName: string;
	/** Saved note groups (Pro). */
	groups: NoteGroup[];
}

export const DEFAULT_FILE_NAME = 'Outline';

export const DEFAULT_SETTINGS: SceneNotesToFountainSettings = {
	sluglineProperty: DEFAULT_MAPPING.slugline,
	synopsisProperty: DEFAULT_MAPPING.synopsis,
	outputFolder: '',
	fileName: DEFAULT_FILE_NAME,
	groups: [],
};

function text(v: unknown, fallback: string): string {
	return typeof v === 'string' && v.trim() !== '' ? v.trim() : fallback;
}

function normalizeGroup(g: unknown): NoteGroup | null {
	if (!g || typeof g !== 'object') return null;
	const o = g as Partial<NoteGroup>;
	if (typeof o.name !== 'string' || !o.name.trim() || typeof o.folder !== 'string' || !Array.isArray(o.paths)) return null;
	return { name: o.name.trim(), folder: o.folder, paths: o.paths.filter((p): p is string => typeof p === 'string') };
}

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<SceneNotesToFountainSettings> | null | undefined): SceneNotesToFountainSettings {
	const s = saved ?? {};
	return {
		sluglineProperty: text(s.sluglineProperty, DEFAULT_SETTINGS.sluglineProperty),
		synopsisProperty: text(s.synopsisProperty, DEFAULT_SETTINGS.synopsisProperty),
		outputFolder: typeof s.outputFolder === 'string' ? s.outputFolder.trim().replace(/^\/+|\/+$/g, '') : '',
		fileName: text(s.fileName, DEFAULT_SETTINGS.fileName),
		groups: Array.isArray(s.groups) ? s.groups.map(normalizeGroup).filter((g): g is NoteGroup => g !== null) : [],
	};
}

export class SceneNotesToFountainSettingTab extends PluginSettingTab {
	plugin: SceneNotesToFountainPlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: SceneNotesToFountainPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		const pro = isPro();
		const lock = pro ? '' : ' Without Pro, the plugin ignores this value and uses the default.';
		return [
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
			{
				type: 'group',
				heading: 'Property mappings and output (Pro)',
				items: [
					{
						name: 'Scene heading property',
						desc: `The text property that holds the scene heading. Default "${DEFAULT_SETTINGS.sluglineProperty}".${lock}`,
						control: { type: 'text', key: 'sluglineProperty', defaultValue: DEFAULT_SETTINGS.sluglineProperty },
					},
					{
						name: 'Synopsis property',
						desc: `The text property that holds the synopsis. Default "${DEFAULT_SETTINGS.synopsisProperty}".${lock}`,
						control: { type: 'text', key: 'synopsisProperty', defaultValue: DEFAULT_SETTINGS.synopsisProperty },
					},
					{
						name: 'Output folder',
						desc: `Folder for new .fountain files. Empty puts the file next to the notes.${lock}`,
						control: { type: 'text', key: 'outputFolder', defaultValue: DEFAULT_SETTINGS.outputFolder },
					},
					{
						name: 'Output file name',
						desc: `File name without .fountain. Default "${DEFAULT_FILE_NAME}".${lock}`,
						control: { type: 'text', key: 'fileName', defaultValue: DEFAULT_SETTINGS.fileName },
					},
				],
			},
			{
				type: 'group',
				heading: 'Saved note groups (Pro)',
				items: this.plugin.settings.groups.length
					? this.plugin.settings.groups.map((g, i) => ({
							name: g.name,
							render: (setting: Setting) => {
								setting.setDesc(`${g.paths.length} notes from ${g.folder || 'the vault root'}`).addExtraButton((b) =>
									b
										.setIcon('trash')
										.setTooltip('Delete this group')
										.onClick(() => void this.plugin.deleteGroup(i).then(() => this.update())),
								);
							},
						}))
					: [{ name: 'No saved groups', desc: 'In the export window, select "Save as note group" to add one.' }],
			},
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
		await this.plugin.saveSettings();
	}
}
