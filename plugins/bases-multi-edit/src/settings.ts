import { PluginSettingTab, type SettingDefinitionItem, type App } from 'obsidian';
import { fillAccountSetting } from './license/github-obsidian';
import { PRO_UI, isPro } from './pro';
import { validateAction, type Action } from './edit';
import type BasesMultiEditPlugin from './main';
import { helloSettingItems } from './hello/settings';
export interface BulkSettings { actions: Action[] }
/** Find items belongs only to Replace list items. */
export function savedAction(a: Action): Action {
	return typeof a.find === 'string' && a.operation === 'replace-items' ? { property: a.property, operation: a.operation, type: a.type, input: a.input, find: a.find } : { property: a.property, operation: a.operation, type: a.type, input: a.input };
}
export function normalizeSettings(value: unknown): BulkSettings {
	const actions: Action[] = [];
	if (value && typeof value === 'object' && 'actions' in value && Array.isArray(value.actions)) {
		for (const item of value.actions.slice(-50) as unknown[]) {
			if (!item || typeof item !== 'object') continue;
			const a = item as Action;
			try { if (typeof a.property !== 'string' || typeof a.input !== 'string') continue; validateAction(a); actions.push(savedAction(a)); } catch { /* Ignore invalid saved data. */ }
		}
	}
	return { actions };
}
export class BulkSettingsTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: BasesMultiEditPlugin) { super(app, plugin); }
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: 'Bulk editing', desc: 'Choose Multi-row edit in the Bases view menu. Select rows, preview a property change, then apply. Undo is available for this session.' },
			{ name: 'Get pro', desc: isPro() ? 'Pro is active.' : `${PRO_UI.proSummary} `, render: setting => { if (!isPro()) setting.descEl.createEl('a', { text: 'Pro: $15 one time or $5 a month', href: 'https://github.com/sponsors/theluckystrike/sponsorships?tier_id=666162&metadata_source=bases-multi-edit' }); } },
			{ name: 'GitHub account', render: setting => this.plugin.pro ? fillAccountSetting(setting, this.plugin.pro, PRO_UI) : undefined },
			{ name: 'Saved bulk actions', desc: `${this.plugin.settings.actions.length} actions stored locally.`, render: setting => { setting.addButton(b => b.setButtonText('Clear saved actions').onClick(async () => { this.plugin.settings.actions = []; await this.plugin.saveData(this.plugin.settings); this.update(); })); } },
		];
	}
}
