import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI, isPro } from './pro';
import { DEFAULT_MAP, FIELDS, TAGS, normalizeMap, type Field, type FieldMap } from './ris';
import type NoteRisExportPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface NamedMap {
	name: string;
	map: FieldMap;
}

/** The last export, for the Pro repeat. hash is the FNV-1a hash of the text that the plugin wrote. */
export interface LastExport {
	folder: string;
	filter: string;
	path: string;
	hash: string;
}

export interface NoteRisExportSettings {
	folder: string;
	output: string;
	map: FieldMap;
	maps: NamedMap[];
	/** Name of the Pro named map in use. "" uses the map of the settings. */
	activeMap: string;
	filter: string;
	repeat: boolean;
	last: LastExport | null;
}

export const DEFAULT_SETTINGS: NoteRisExportSettings = {
	folder: '',
	output: 'References.ris',
	map: { ...DEFAULT_MAP },
	maps: [],
	activeMap: '',
	filter: '',
	repeat: false,
	last: null,
};

const LABELS: Record<Field, string> = {
	type: 'Type property',
	title: 'Title property',
	authors: 'Authors property',
	year: 'Year property',
	journal: 'Journal property',
	doi: 'DOI property',
	url: 'URL property',
	abstract: 'Abstract property',
};

const str = (v: unknown, d: string): string => (typeof v === 'string' ? v : d);

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<NoteRisExportSettings> | null | undefined): NoteRisExportSettings {
	const s = saved ?? {};
	const maps = Array.isArray(s.maps)
		? s.maps.filter((m): m is NamedMap => !!m && typeof m.name === 'string' && !!m.name.trim()).map((m) => ({ name: m.name.trim(), map: normalizeMap(m.map) }))
		: [];
	const l = s.last;
	const last = l && typeof l === 'object' && typeof l.path === 'string' && typeof l.hash === 'string' ? { folder: str(l.folder, ''), filter: str(l.filter, ''), path: l.path, hash: l.hash } : null;
	const output = str(s.output, '').trim();
	return {
		folder: str(s.folder, ''),
		output: output || DEFAULT_SETTINGS.output,
		map: normalizeMap(s.map),
		maps,
		activeMap: typeof s.activeMap === 'string' && maps.some((m) => m.name === s.activeMap) ? s.activeMap : '',
		filter: str(s.filter, ''),
		repeat: typeof s.repeat === 'boolean' ? s.repeat : false,
		last,
	};
}

export class NoteRisExportSettingTab extends PluginSettingTab {
	plugin: NoteRisExportPlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: NoteRisExportPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: 'Reference folder', desc: 'The export reads the Markdown notes in this folder and its subfolders. Empty means the vault root.', control: { type: 'text', key: 'folder', defaultValue: '' } },
			{ name: 'Output file', desc: 'Path of the new RIS file. If the file exists, the export adds (2), (3) and so on to the name.', control: { type: 'text', key: 'output', defaultValue: DEFAULT_SETTINGS.output } },
			{
				type: 'group',
				heading: 'Field map',
				items: FIELDS.map((f) => ({
					name: LABELS[f],
					desc: `The property key for the RIS tag ${TAGS[f]}. Empty uses "${DEFAULT_MAP[f]}".`,
					control: { type: 'text' as const, key: `map.${f}`, defaultValue: DEFAULT_MAP[f] },
				})),
			},
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
			{
				name: 'Named field maps (Pro)',
				desc: 'Save the field map above with a name. Select a name to use its map in the export window.',
				render: (setting) => {
					let name = '';
					setting.addText((t) => t.setPlaceholder('Map name').onChange((v) => { name = v; }));
					setting.addButton((b) => b.setButtonText('Save map').setDisabled(!isPro()).onClick(async () => {
						if (await this.plugin.saveMap(name)) this.update();
					}));
					for (const m of this.plugin.settings.maps) {
						setting.addButton((b) => b.setButtonText(`Delete ${m.name}`).setDisabled(!isPro()).onClick(async () => {
							await this.plugin.deleteMap(m.name);
							this.update();
						}));
					}
				},
			},
			{
				name: 'Repeat export when mapped fields change (Pro)',
				desc: 'After the last export, a change to a mapped property in its folder writes the export again. The plugin updates its own RIS file only when that file has no other change. Else it saves a new file.',
				render: (setting) => {
					setting.addToggle((t) => t.setValue(this.plugin.settings.repeat).setDisabled(!isPro()).onChange(async (v) => {
						await this.plugin.setRepeat(v);
						this.update();
					}));
				},
			},
		];
	}

	getControlValue(key: string): unknown {
		if (key.startsWith('map.')) return this.plugin.settings.map[key.slice(4) as Field];
		return super.getControlValue(key);
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key.startsWith('map.')) {
			this.plugin.settings.map = normalizeMap({ ...this.plugin.settings.map, [key.slice(4)]: value });
			await this.plugin.saveSettings();
			return;
		}
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
		await this.plugin.saveSettings();
	}
}
