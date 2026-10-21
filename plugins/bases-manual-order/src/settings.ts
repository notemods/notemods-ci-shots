import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { fillAccountSetting, fillGetProSetting } from './license/github-obsidian';
import { PRO_UI, isPro } from './pro';
import type BasesManualOrderPlugin from './main';
export class BasesManualOrderSettingTab extends PluginSettingTab {
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], private readonly host: BasesManualOrderPlugin) { super(app, host); }
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: 'Row ordering', desc: 'Choose Manual order in a Bases view menu. Drag a handle or use the up and down buttons. The default numeric property is manual_order.' },
			...(this.host.pro ? [
				...(!isPro() ? [{ name: 'Get pro', render: (setting: Parameters<typeof fillGetProSetting>[0]) => {
					fillGetProSetting(setting, this.host.pro!, PRO_UI);
					setting.setDesc(createFragment(f => {
						f.appendText('Pro adds custom rank properties. $15 one time or $5 a month. ');
						f.createEl('a', { text: 'Get the upgrade for $15', href: 'https://github.com/sponsors/theluckystrike/sponsorships?tier_id=666162&metadata_source=bases-manual-order' });
					}));
				} }] : []),
				{ name: 'GitHub account', render: (setting: Parameters<typeof fillAccountSetting>[0]) => fillAccountSetting(setting, this.host.pro!, PRO_UI) },
			] : []),
		];
	}
}
