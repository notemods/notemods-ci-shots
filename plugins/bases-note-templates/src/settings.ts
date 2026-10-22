import { PluginSettingTab, type SettingDefinition, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { DEFAULT_SETTINGS, describeBase, effectiveFor, normalizeSettings } from './config';
import { PRO_UI, isPro } from './pro';
import type BasesNoteTemplatesPlugin from './main';
import { helloSettingItems } from './hello/settings';

export class BasesNoteTemplatesSettingTab extends PluginSettingTab {
	plugin: BasesNoteTemplatesPlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: BasesNoteTemplatesPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		const s = this.plugin.settings;
		const paths = Object.keys(s.bases).sort();
		const items: SettingDefinition[] = paths.map((path) => {
			const cfg = s.bases[path];
			const locked = effectiveFor(s, path, '', isPro())?.locked ?? [];
			const note = locked.length ? ` Needs pro: ${locked.join(', ')}.` : '';
			return { name: path, desc: cfg ? `${describeBase(cfg)}${note}` : '' };
		});
		return [
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
			{
				name: 'Use templates with the New button',
				desc: 'Main switch. When on, a note made with New in a base that has a setup, or in an embed of that base in a note, gets its template and name pattern. Off = only the command and the header button use templates.',
				control: { type: 'toggle', key: 'hookNew', defaultValue: DEFAULT_SETTINGS.hookNew },
			},
			{
				name: 'Date format',
				desc: 'Format of {{date}} in templates and name patterns. Uses moment.js tokens such as YYYY-MM-DD.',
				control: { type: 'text', key: 'dateFormat', defaultValue: DEFAULT_SETTINGS.dateFormat, placeholder: 'YYYY-MM-DD' },
			},
			{
				name: 'Time format',
				desc: 'Format of {{time}}, for example HH:mm.',
				control: { type: 'text', key: 'timeFormat', defaultValue: DEFAULT_SETTINGS.timeFormat, placeholder: 'HH:mm' },
			},
			{
				name: 'Run Templater on new notes',
				desc: 'Pro. When a new note still has Templater tags (<% %>) and the Templater plugin is on, Templater fills them in.',
				control: { type: 'toggle', key: 'templater', defaultValue: DEFAULT_SETTINGS.templater },
			},
			{
				type: 'list',
				heading: 'Bases with templates',
				emptyState: 'No base has a setup yet. Open a base and run "Set up templates for this base".',
				items,
				onDelete: (index: number) => {
					const path = paths[index];
					if (path !== undefined) void this.plugin.saveBase(path, null);
				},
			},
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
	}
}
