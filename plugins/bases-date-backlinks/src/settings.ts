import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_ONE_TIME_URL, PRO_UI, isPro } from './pro';
import type BasesDateBacklinksPlugin from './main';

export class DateBacklinksSettingTab extends PluginSettingTab {
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], private readonly plugin: BasesDateBacklinksPlugin) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const proLink = createFragment((fragment) => {
			fragment.createSpan({ text: 'Pro adds week and month rollups, extra date properties and date ranges. ' });
			fragment.createEl('a', { text: 'Get pro for $15 once', href: PRO_ONE_TIME_URL });
		});
		return [
			{
				name: 'Add to the daily notes template',
				desc: 'Preview an embed in the template configured by Daily notes or Periodic Notes. Add it once for all new daily notes.',
				render: (setting) => { setting.addButton((button) => button.setButtonText('Add to the daily notes template').onClick(() => void this.plugin.previewTemplate())); },
			},
			{
				name: 'Show automatically in daily notes',
				desc: 'Show the shared view below any open daily note that matches the configured daily format and has no embed. Does not edit the note.',
				render: (setting) => { setting.addToggle((toggle) => toggle.setValue(this.plugin.settings.autoShow).onChange((value) => this.plugin.setAutoShow(value))); },
			},
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
			{
				name: 'Get pro for $15 once',
				desc: proLink,
				visible: () => !isPro(),
			},
			{
				name: 'Free features',
				desc: 'Set up the daily notes template once, or show the view automatically. It lists notes with one selected date property for that day.',
			},
		];
	}
}
