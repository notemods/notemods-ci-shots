import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import type VaultPathPortabilityPlugin from './main';
import { PRO_UI } from './pro';

export interface VaultPathPortabilitySettings { autoScan: boolean }
export const DEFAULT_SETTINGS: VaultPathPortabilitySettings = { autoScan: false };
export function normalizeSettings(saved: unknown): VaultPathPortabilitySettings {
	return { autoScan: !!saved && typeof saved === 'object' && 'autoScan' in saved && saved.autoScan === true };
}
export class VaultPathPortabilitySettingTab extends PluginSettingTab {
	declare plugin: VaultPathPortabilityPlugin;
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: 'Scan when paths change (Pro)', desc: 'Scan after file or folder creation, rename or deletion. Show a count in the desktop status bar.', control: { type: 'toggle', key: 'autoScan', defaultValue: false } },
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
			{ name: 'One-time offer', visible: () => !this.plugin.pro?.isPro(), render: setting => { setting.descEl.createEl('a', { text: 'Pro: $15 one time or $5 a month', href: 'https://github.com/sponsors/theluckystrike/sponsorships?tier_id=666162&metadata_source=vault-path-portability' }); } },
		];
	}
	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		this.plugin.updateAutoScan();
	}
}
