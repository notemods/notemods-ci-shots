import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI } from './pro';
import type RevisionSessionMarksPlugin from './main';
import { helloSettingItems } from './hello/settings';

export class RevisionSessionMarksSettingTab extends PluginSettingTab {
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], readonly plugin: RevisionSessionMarksPlugin) { super(app, plugin); }
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: 'Baseline name (Pro)', desc: 'Name used by the named baseline and folder commands. One name can be used for several notes.', control: { type: 'text', key: 'baselineName', defaultValue: 'First draft' } },
			{ name: 'Author label (Pro)', desc: 'Optional label in a CriticMarkup comment. Maximum 80 characters.', control: { type: 'text', key: 'author', defaultValue: '' } },
			{ name: 'Change summary (Pro)', desc: 'Add the number of addition, deletion and substitution marks in a comment.', control: { type: 'toggle', key: 'includeSummary', defaultValue: false } },
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
		];
	}
	async setControlValue(key: string, value: unknown): Promise<void> {
		if ((key === 'baselineName' || key === 'author') && typeof value === 'string') this.plugin.settings[key] = value.slice(0, 80);
		if (key === 'includeSummary' && typeof value === 'boolean') this.plugin.settings.includeSummary = value;
		await this.plugin.saveSettings();
	}
}
