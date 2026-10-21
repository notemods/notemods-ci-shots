import { PluginSettingTab, type App, type SettingDefinitionItem } from 'obsidian';
import { fillAccountSetting } from './license/github-obsidian';
import { isPro, PRO_UI } from './pro';
import type DatePropertyAlertsPlugin from './main';

export class AlertSettingTab extends PluginSettingTab {
 constructor(app: App, private readonly host: DatePropertyAlertsPlugin) { super(app, host); }
 getSettingDefinitions(): SettingDefinitionItem[] {
  const pro = this.host.pro;
  return [
   { name: 'Alert sources', desc: 'In a base, add an Alerts view and select a note date property. Keep that view or embed open. Notices work while Obsidian is running on desktop or mobile; there are no system push notifications.' },
   ...(!isPro() ? [{ name: 'Get Pro', desc: createFragment(f => { f.appendText(`${PRO_UI.proSummary} $15 one time or $5 a month. `); f.createEl('a', { text: 'Sponsor for $15', href: 'https://github.com/sponsors/theluckystrike/sponsorships?tier_id=666162&metadata_source=date-property-alerts' }); }) }] : []),
   ...(pro ? [{ name: 'GitHub account', render: (setting: Parameters<typeof fillAccountSetting>[0]) => fillAccountSetting(setting, pro, PRO_UI) }] : []),
  ];
 }
}
