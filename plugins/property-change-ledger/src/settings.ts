import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI } from './pro';
import type LedgerPlugin from './main';
import { helloSettingItems } from './hello/settings';
export interface Profile { name: string; folder: string; keys: string; ledger: string }
export interface LedgerSettings { folder: string; keys: string; ledger: string; profiles: Profile[] }
export const DEFAULT_SETTINGS: LedgerSettings = { folder: 'Notes', keys: 'status, due', ledger: 'Property history.md', profiles: [] };
export function normalizeSettings(saved: unknown): LedgerSettings {
	const s = saved && typeof saved === 'object' ? saved as Partial<LedgerSettings> : {};
	return {
		folder: typeof s.folder === 'string' ? s.folder : DEFAULT_SETTINGS.folder,
		keys: typeof s.keys === 'string' ? s.keys : DEFAULT_SETTINGS.keys,
		ledger: typeof s.ledger === 'string' && s.ledger.endsWith('.md') ? s.ledger : DEFAULT_SETTINGS.ledger,
		profiles: Array.isArray(s.profiles) ? s.profiles.filter((p): p is Profile => !!p && typeof p.name === 'string' && typeof p.folder === 'string' && typeof p.keys === 'string' && typeof p.ledger === 'string') : [],
	};
}
export class LedgerSettingTab extends PluginSettingTab {
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], public plugin: LedgerPlugin) { super(app, plugin); }
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: 'Watch folder and exact keys', desc: `${this.plugin.settings.folder || 'Vault root'} • ${this.plugin.settings.keys}`, render: setting => { setting.addButton(b => b.setButtonText('Set watch').onClick(() => this.plugin.openWatch())); } },
			{ name: 'Local ledger', desc: this.plugin.settings.ledger + '. Values can contain private data. This file is ordinary vault data.' },
			{ name: 'Pending writes', desc: `${this.plugin.writer.pending} pending. A failed write stays in memory until retry or plugin unload.`, render: setting => { setting.addButton(b => b.setButtonText('Retry').onClick(() => this.plugin.flush())); } },
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
		];
	}
}
