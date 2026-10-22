import { PluginSettingTab, type SettingDefinition, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { MAX_FROZEN } from './layout';
import { PRO_UI } from './pro';
import { DEFAULT_SETTINGS, EMBED_HEIGHT_MAX, EMBED_HEIGHT_MIN, FREE_COLUMNS, normalizeSettings, type FileChoice, type FreezeSettings, type ViewChoice } from './scope';
import type BasesFreezePanesPlugin from './main';
import { helloSettingItems } from './hello/settings';

/** One line for a file's choice in the list of single-file choices. */
export function describeChoice(choice: FileChoice, pro: boolean): string {
	if (choice.off) return 'Frozen panes off for this file.';
	const n = choice.columns ?? 0;
	const text = `${n} frozen ${n === 1 ? 'column' : 'columns'}.`;
	return pro ? text : `${text} Needs pro; the default applies until pro is on.`;
}

/** One line for a view's choice in the list of single-file choices. */
export function describeViewChoice(choice: ViewChoice, pro: boolean): string {
	if (choice.off) return 'Frozen panes off for this view.';
	const parts: string[] = [];
	if (choice.header !== undefined) parts.push(choice.header ? 'Header row frozen.' : 'Header row not frozen.');
	if (choice.columns !== undefined) {
		const n = choice.columns;
		parts.push(`${n} frozen ${n === 1 ? 'column' : 'columns'}.${pro ? '' : ' Needs pro; the file choice applies until pro is on.'}`);
	}
	return parts.join(' ');
}

/** One row of the list of single-file choices: a file, or one view of a file (shown as "file > view"). */
export interface ChoiceRow {
	path: string;
	view: string | null;
	name: string;
	desc: string;
}

/** The rows of the list, sorted by path. A view keeps its row after the view is renamed in the base, so it can be deleted. */
export function choiceRows(settings: FreezeSettings, pro: boolean): ChoiceRow[] {
	const rows: ChoiceRow[] = [];
	for (const path of Object.keys(settings.files).sort()) {
		const choice = settings.files[path] ?? {};
		if (choice.off || choice.columns !== undefined) rows.push({ path, view: null, name: path, desc: describeChoice(choice, pro) });
		for (const view of Object.keys(choice.views ?? {}).sort()) {
			const viewChoice = choice.views?.[view];
			if (viewChoice) rows.push({ path, view, name: `${path} > ${view}`, desc: describeViewChoice(viewChoice, pro) });
		}
	}
	return rows;
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
		const rows = choiceRows(this.plugin.settings, pro());
		const fileItems: SettingDefinition[] = rows.map((row) => ({ name: row.name, desc: row.desc }));
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
				emptyState: 'No file or view has its own choice. Use the commands for the current file or the current view to add one.',
				items: fileItems,
				onDelete: (index: number) => {
					const row = rows[index];
					if (!row) return;
					const done = row.view === null ? this.plugin.forgetFileChoice(row.path) : this.plugin.forgetViewChoice(row.path, row.view);
					void done.then(() => this.update());
				},
			},
			{
				name: 'Forget choices for single files',
				desc: 'Removes every choice made with the commands for the current file and the current view, so all files and views use the settings above again.',
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
