// Use imperative settings to support Obsidian 1.11.4.
import { PluginSettingTab as LegacySettingTab, Setting } from 'obsidian';
import { fillGetProSetting, fillAccountSetting } from './sponsors-adapter';
import { PRO_LABEL, PRO_UI } from './pro';
import type SecretParcelPlugin from './main';
import { renderHelloSettings } from './hello/index';
export interface Profile { name: string; prefix: string; folder: string }
export interface SecretParcelSettings { folder: string; keep: number; profiles: Profile[]; backups: string[] }
export const DEFAULT_SETTINGS: SecretParcelSettings = { folder: 'Secret Parcels', keep: 5, profiles: [], backups: [] };
export function normalizeSettings(input: Partial<SecretParcelSettings> | null | undefined): SecretParcelSettings {
 const s = input ?? {};
 return { folder: typeof s.folder === 'string' ? s.folder : DEFAULT_SETTINGS.folder,
 keep: typeof s.keep === 'number' && Number.isFinite(s.keep) ? Math.max(1, Math.min(100, Math.round(s.keep))) : 5,
 profiles: Array.isArray(s.profiles) ? s.profiles.filter(p => p && typeof p.name === 'string' && typeof p.prefix === 'string' && typeof p.folder === 'string').slice(0, 50) : [],
 backups: Array.isArray(s.backups) ? s.backups.filter((p): p is string => typeof p === 'string' && /(?:^|\/)backup-\d{4}-\d{2}-\d{2}-\d{4}(?:-\d+)?\.secretparcel\.json$/.test(p)).slice(-1000) : [] };
}
export class SecretParcelSettingTab extends LegacySettingTab {
 private stop: (() => void) | null = null;
 constructor(app: ConstructorParameters<typeof LegacySettingTab>[0], readonly plugin: SecretParcelPlugin) { super(app, plugin); }
 display(): void {
  this.stop?.(); this.containerEl.empty();
  new Setting(this.containerEl).setName('Export folder').setDesc('A normal folder inside this vault. You can change it for one export.').addText(t => t.setValue(this.plugin.prefs.folder).onChange(v => { this.plugin.prefs.folder = v; void this.plugin.saveSettings(); }));
  new Setting(this.containerEl).setName(`Backup retention (${PRO_LABEL})`).setDesc('Keep 1 to 100 tracked backups. Older tracked files are removed with the Obsidian deletion preference after a successful backup.').addText(t => t.setValue(String(this.plugin.prefs.keep)).onChange(v => { const n = Number(v); if (Number.isInteger(n) && n >= 1 && n <= 100) { this.plugin.prefs.keep = n; void this.plugin.saveSettings(); } }));
  new Setting(this.containerEl).setName(`Saved export profiles (${PRO_LABEL})`).setDesc('Save a name, ID prefix and folder. Passphrases are not saved.').addButton(b => b.setButtonText('Manage profiles').onClick(() => this.plugin.openProfiles()));
  new Setting(this.containerEl).setName('Pro').setHeading();
  if (this.plugin.pro) { fillGetProSetting(new Setting(this.containerEl), this.plugin.pro, PRO_UI); this.stop = fillAccountSetting(new Setting(this.containerEl), this.plugin.pro, PRO_UI); }
  renderHelloSettings(this.containerEl);
 }
 hide(): void { this.stop?.(); this.stop = null; }
}
