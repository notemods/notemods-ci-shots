import { PluginSettingTab, type SettingDefinition, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { MAX_FROZEN } from './layout';
import { PRO_UI } from './pro';
import { DEFAULT_SETTINGS, EMBED_HEIGHT_MAX, EMBED_HEIGHT_MIN, FREE_COLUMNS, normalizeSettings, type FileChoice } from './scope';
import type BasesFreezePanesPlugin from './main';
import { helloSettingItems } from './hello/settings';

/** One line for a file's choice in the list of single-file choices. */
export function describeChoice(choice: FileChoice, pro: boolean): string {
	if (choice.off) return 'Frozen panes off for this file.';
	const n = choice.columns ?? 0;
	const text = `${n} frozen ${n === 1 ? 'column' : 'columns'}.`;
	return pro ? text : `${text} Needs pro; the default applies until pro is on.`;
}

export class BasesFreezePanesSettingTab extends PluginSettingTab {
	plugin: BasesFreezePanesPlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: BasesFreezePanesPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		const fileCount = () => Object.keys(this.plugin.settings.files).length;
		const pro = () => this.plugin.isPro();
		const paths = Object.keys(this.plugin.settings.files).sort();
		const fileItems: SettingDefinition[] = paths.map((path) => ({ name: path, desc: describeChoice(this.plugin.settings.files[path] ?? {}, pro()) }));
		return [
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
			{
				name: 'Freeze panes',
				desc: 'Main switch. Off leaves every Bases table exactly as the app draws it.',
				control: { type: 'toggle', key: 'enabled', defaultValue: DEFAULT_SETTINGS.enabled },
			},
			{
				name: 'Freeze the header row',
				desc: 'Gives the header row a solid background and caps the height of tables embedded in notes, so the header stays at the top while you scroll inside the table.',
				control: { type: 'toggle', key: 'freezeHeader', defaultValue: DEFAULT_SETTINGS.freezeHeader },
			},
			{
				name: 'Freeze Markdown and Dataview tables',
				desc: 'Free. Keeps rendered note tables in a scroll box. Uses the header switch and freezes the first column when Frozen columns is above 0. The height setting also applies to these tables.',
				control: { type: 'toggle', key: 'freezeNoteTables', defaultValue: DEFAULT_SETTINGS.freezeNoteTables },
			},
			{
				name: 'Frozen columns',
				desc: `How many columns on the left stay in view when you scroll sideways, from 0 to ${MAX_FROZEN}. The first column is usually the file name. ${FREE_COLUMNS} column is free; 2 and 3 need pro.`,
				control: { type: 'slider', key: 'columns', defaultValue: DEFAULT_SETTINGS.columns, min: 0, max: MAX_FROZEN, step: 1 },
			},
			{
				name: 'Freeze the last column',
				desc: 'Pro. Keeps the last column at the right edge while you scroll, for a status, a total or a date column.',
				control: { type: 'toggle', key: 'freezeLast', defaultValue: DEFAULT_SETTINGS.freezeLast },
			},
			{
				name: 'Pin a property',
				desc: 'Pro. Type a property name such as status, note.status or formula.total. If the property is visible in a Bases table, it stays next to the frozen columns. Empty turns this off.',
				control: { type: 'text', key: 'pinProperty', defaultValue: DEFAULT_SETTINGS.pinProperty },
			},
			{
				name: 'Embedded table height',
				desc: `Largest height in pixels of a table embedded in a note, from ${EMBED_HEIGHT_MIN} to ${EMBED_HEIGHT_MAX}. Taller tables scroll inside this box. Tables in base files use the whole tab.`,
				control: { type: 'slider', key: 'embedHeight', defaultValue: DEFAULT_SETTINGS.embedHeight, min: EMBED_HEIGHT_MIN, max: EMBED_HEIGHT_MAX, step: 50 },
			},
			{
				type: 'list',
				heading: 'Choices for single files',
				emptyState: 'No file has its own choice. Use the commands for the current file to add one.',
				items: fileItems,
				onDelete: (index: number) => {
					const path = paths[index];
					if (path !== undefined) void this.plugin.forgetFileChoice(path).then(() => this.update());
				},
			},
			{
				name: 'Forget choices for single files',
				desc: 'Removes every choice made with the commands for the current file, so all files use the settings above again.',
				disabled: () => fileCount() === 0,
				action: () => {
					void this.plugin.forgetFileChoices().then(() => this.update());
				},
			},
			{
				name: 'Column freezing is not available',
				desc: 'This version of the app draws Bases tables in a way the plugin does not recognize, so only the header row is frozen.',
				visible: () => !this.plugin.columnsSupported,
			},
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
		this.plugin.refresh();
	}
}
