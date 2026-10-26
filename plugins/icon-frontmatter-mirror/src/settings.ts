import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { helloSettingItems } from './hello/settings';
import { PRO_UI, isPro } from './pro';
import type { FolderNoteMode, IconFormat, PlanOptions } from './mirror';
import type { MirrorStatus } from './engine';
import type IconFrontmatterMirrorPlugin from './main';

export interface IconFrontmatterMirrorSettings {
	/** Use the frontmatter field names from the Iconize settings when Iconize has them. */
	useIconizeNames: boolean;
	/** The icon property when useIconizeNames is off or Iconize has no name. */
	iconProperty: string;
	/** Also mirror the Iconize icon color. */
	mirrorColor: boolean;
	/** The color property when useIconizeNames is off or Iconize has no name. */
	colorProperty: string;
	/** Seconds between two checks of the Iconize data file. */
	pollSeconds: number;
	/** Pro: one or two more properties, each with a format. An empty name is off. */
	extra1Property: string;
	extra1Format: IconFormat;
	extra2Property: string;
	extra2Format: IconFormat;
	/** Pro: write folder icons to the folder note. */
	folderNotes: boolean;
	folderNoteMode: FolderNoteMode;
	folderProperty: string;
}

export const FORMATS: Record<IconFormat, string> = {
	stored: 'As Iconize stores it (LiHouse)',
	name: 'Name without the pack prefix (House)',
	kebab: 'Lowercase with dashes (house)',
};

export const FOLDER_MODES: Record<FolderNoteMode, string> = {
	'same-name': 'Folder/Folder.md',
	index: 'Folder/index.md',
};

export const DEFAULT_SETTINGS: IconFrontmatterMirrorSettings = {
	useIconizeNames: true,
	iconProperty: 'icon',
	mirrorColor: true,
	colorProperty: 'iconColor',
	pollSeconds: 2,
	extra1Property: '',
	extra1Format: 'kebab',
	extra2Property: '',
	extra2Format: 'name',
	folderNotes: false,
	folderNoteMode: 'same-name',
	folderProperty: 'folderIcon',
};

function str(v: unknown, d: string): string {
	return typeof v === 'string' ? v.trim() : d;
}
function bool(v: unknown, d: boolean): boolean {
	return typeof v === 'boolean' ? v : d;
}
function oneOf<T extends string>(v: unknown, options: Record<T, string>, d: T): T {
	return typeof v === 'string' && v in options ? (v as T) : d;
}

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<IconFrontmatterMirrorSettings> | null | undefined): IconFrontmatterMirrorSettings {
	const s = (saved ?? {}) as Record<string, unknown>;
	const d = DEFAULT_SETTINGS;
	const poll = typeof s.pollSeconds === 'number' && Number.isFinite(s.pollSeconds) ? Math.min(60, Math.max(1, Math.round(s.pollSeconds))) : d.pollSeconds;
	return {
		useIconizeNames: bool(s.useIconizeNames, d.useIconizeNames),
		iconProperty: str(s.iconProperty, d.iconProperty) || d.iconProperty,
		mirrorColor: bool(s.mirrorColor, d.mirrorColor),
		colorProperty: str(s.colorProperty, d.colorProperty) || d.colorProperty,
		pollSeconds: poll,
		extra1Property: str(s.extra1Property, d.extra1Property),
		extra1Format: oneOf(s.extra1Format, FORMATS, d.extra1Format),
		extra2Property: str(s.extra2Property, d.extra2Property),
		extra2Format: oneOf(s.extra2Format, FORMATS, d.extra2Format),
		folderNotes: bool(s.folderNotes, d.folderNotes),
		folderNoteMode: oneOf(s.folderNoteMode, FOLDER_MODES, d.folderNoteMode),
		folderProperty: str(s.folderProperty, d.folderProperty) || d.folderProperty,
	};
}

/**
 * The plan options in effect. iconField and colorField are the names from the Iconize settings (null when unset).
 * Without Pro: no extra properties and no folder notes. A property name is used once only.
 */
export function effectiveOptions(s: IconFrontmatterMirrorSettings, pro: boolean, iconField: string | null, colorField: string | null): PlanOptions {
	const iconProperty = (s.useIconizeNames && iconField) || s.iconProperty;
	const colorName = (s.useIconizeNames && colorField) || s.colorProperty;
	const colorProperty = s.mirrorColor && colorName !== iconProperty ? colorName : null;
	const used = new Set([iconProperty, colorProperty].filter((x): x is string => x !== null));
	const extras: PlanOptions['extras'] = [];
	if (pro) {
		for (const [property, format] of [
			[s.extra1Property, s.extra1Format],
			[s.extra2Property, s.extra2Format],
		] as const) {
			if (!property || used.has(property)) continue;
			used.add(property);
			extras.push({ property, format });
		}
	}
	const folderNotes = pro && s.folderNotes && !used.has(s.folderProperty) ? { mode: s.folderNoteMode, property: s.folderProperty } : null;
	return { iconProperty, colorProperty, extras, folderNotes };
}

/** One line about the state of the mirror for the settings tab. */
export function statusText(st: MirrorStatus, dataPath: string): string {
	if (st.state === 'starting') return 'Waiting for the first check of the Iconize data.';
	const off = st.iconizeEnabled === false ? ' Iconize is not turned on in Community plugins.' : '';
	if (st.state === 'missing') return `Iconize data not found at ${dataPath}. Install Iconize and set an icon on a note.${off}`;
	if (st.state === 'broken') return `The Iconize data file is not complete or not valid. The plugin waits for the next change and writes nothing until then.${off}`;
	const c = st.counts;
	const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
	const parts = [
		`${n(c.notes, 'note icon', 'note icons')} mirrored.`,
		c.folders ? `${n(c.folders, 'folder icon', 'folder icons')} skipped, because folders have no properties${c.folderNotes ? ` (${c.folderNotes} sent to folder notes)` : ''}.` : '',
		c.other ? `${n(c.other, 'icon', 'icons')} of other file types skipped.` : '',
		c.missing ? `${n(c.missing, 'icon', 'icons')} for paths that do not exist skipped.` : '',
		`Last run wrote ${st.written} and removed ${st.removed} values.`,
		st.conflicts.length ? `${n(st.conflicts.length, 'conflict', 'conflicts')}: notes that already have another value.` : 'No conflicts.',
		st.waiting ? `${n(st.waiting, 'note waits', 'notes wait')} for the metadata cache.` : '',
	];
	return parts.filter(Boolean).join(' ') + off;
}

export class IconFrontmatterMirrorSettingTab extends PluginSettingTab {
	plugin: IconFrontmatterMirrorPlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: IconFrontmatterMirrorPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		const engine = this.plugin.engine;
		const pro = isPro();
		return [
			{
				name: 'Status',
				desc: engine ? statusText(engine.status, engine.dataPath) : '',
			},
			{
				name: 'Mirror icons now',
				desc: 'Read the Iconize data again and update the properties.',
				action: () => void this.plugin.mirrorNow(),
			},
			{
				name: 'Show icon conflicts',
				desc: 'List the notes that have another value in the property. The plugin does not change them.',
				action: () => this.plugin.showConflicts(),
			},
			{
				name: 'Use the Iconize property names',
				desc: 'Use the frontmatter field names from the Iconize settings (default icon and iconColor). Iconize then reads the same property.',
				control: { type: 'toggle', key: 'useIconizeNames', defaultValue: DEFAULT_SETTINGS.useIconizeNames },
			},
			{
				name: 'Icon property',
				desc: 'The property for the icon when the setting above is off. If you change it, the values in the old property stay as they are.',
				control: { type: 'text', key: 'iconProperty', defaultValue: DEFAULT_SETTINGS.iconProperty, validate: (v: string) => (v.trim() ? undefined : 'Type a property name.'), disabled: () => this.plugin.settings.useIconizeNames },
			},
			{
				name: 'Mirror icon color',
				desc: 'Also write the icon color that you set in Iconize.',
				control: { type: 'toggle', key: 'mirrorColor', defaultValue: DEFAULT_SETTINGS.mirrorColor },
			},
			{
				name: 'Color property',
				desc: 'The property for the icon color when the Iconize names are off.',
				control: { type: 'text', key: 'colorProperty', defaultValue: DEFAULT_SETTINGS.colorProperty, validate: (v: string) => (v.trim() ? undefined : 'Type a property name.'), disabled: () => this.plugin.settings.useIconizeNames },
			},
			{
				name: 'Check interval in seconds',
				desc: 'How often the plugin checks the Iconize data file for a change. From 1 to 60.',
				control: { type: 'number', key: 'pollSeconds', defaultValue: DEFAULT_SETTINGS.pollSeconds, min: 1, max: 60, step: 1, validate: (v: number) => (Number.isFinite(v) && v >= 1 && v <= 60 ? undefined : 'Type a number from 1 to 60.') },
			},
			{
				type: 'group',
				heading: 'Pro options',
				items: [
					{
						name: 'Extra property 1',
						desc: 'Pro. Also write the icon to this property, in the format below. Leave empty to turn it off.',
						control: { type: 'text', key: 'extra1Property', defaultValue: '', placeholder: 'lucideIcon', disabled: () => !isPro() },
					},
					{
						name: 'Extra property 1 format',
						desc: 'Pro. Emoji stay as they are in each format.',
						control: { type: 'dropdown', key: 'extra1Format', defaultValue: DEFAULT_SETTINGS.extra1Format, options: { ...FORMATS }, disabled: () => !isPro() },
					},
					{
						name: 'Extra property 2',
						desc: 'Pro. A second extra property. Leave empty to turn it off.',
						control: { type: 'text', key: 'extra2Property', defaultValue: '', disabled: () => !isPro() },
					},
					{
						name: 'Extra property 2 format',
						desc: 'Pro.',
						control: { type: 'dropdown', key: 'extra2Format', defaultValue: DEFAULT_SETTINGS.extra2Format, options: { ...FORMATS }, disabled: () => !isPro() },
					},
					{
						name: 'Folder icons to folder notes',
						desc: 'Pro. Write the icon of a folder to its folder note, if the note exists. The plugin does not make notes.',
						control: { type: 'toggle', key: 'folderNotes', defaultValue: DEFAULT_SETTINGS.folderNotes, disabled: () => !isPro() },
					},
					{
						name: 'Folder note',
						desc: 'Pro. The note that holds the folder icon.',
						control: { type: 'dropdown', key: 'folderNoteMode', defaultValue: DEFAULT_SETTINGS.folderNoteMode, options: { ...FOLDER_MODES }, disabled: () => !isPro() },
					},
					{
						name: 'Folder icon property',
						desc: 'Pro. The property in the folder note.',
						control: { type: 'text', key: 'folderProperty', defaultValue: DEFAULT_SETTINGS.folderProperty, disabled: () => !isPro() },
					},
					{
						name: 'Pro features',
						desc: pro
							? 'Pro is on: the extra properties and the folder notes work.'
							: 'Free version: each note icon and color from Iconize is mirrored to the note, kept current and removed when you remove the icon. Pro adds two extra properties with a format each, and folder icons in folder notes.',
					},
				],
			},
			// The Pro group comes after the settings of the plugin.
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		// The plugin data also holds the ledger, so the plugin saves both.
		this.plugin.settings = normalizeSettings({ ...this.plugin.settings, [key]: value });
		await this.plugin.saveAll();
		this.plugin.settingsChanged(key);
	}
}
