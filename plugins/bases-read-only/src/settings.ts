import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI, isPro } from './pro';
import type BasesReadOnlyPlugin from './main';
import { helloSettingItems } from './hello/settings';

export class BasesReadOnlySettingTab extends PluginSettingTab {
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], public plugin: BasesReadOnlyPlugin) { super(app, plugin); }
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: 'Locked bases', desc: this.plugin.settings.locked.length ? this.plugin.settings.locked.join(', ') : 'No manual locks. Use the command or a base file menu to add a lock.' },
			{ name: 'Lock rules (Pro)', desc: 'One folder or glob per line. Example: Archive/**.base. Rules apply while Pro is on.', control: { type: 'textarea', key: 'rulesText', rows: 3, defaultValue: '', placeholder: 'Archive/**.base', disabled: !isPro() } },
			{ name: 'Editable properties (Pro)', desc: 'Property names, separated by commas. Only cells with a known property can use this list. Drags and view changes stay blocked.', control: { type: 'text', key: 'editableText', defaultValue: '', placeholder: 'done, priority', disabled: !isPro() } },
			{ name: 'Kiosk mode (Pro)', desc: 'Lock the base files in this vault, including new bases. Turn this off before you unlock a base.', control: { type: 'toggle', key: 'kiosk', defaultValue: false, disabled: !isPro() } },
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
		];
	}
	getControlValue(key: string): unknown {
		if (key === 'rulesText') return this.plugin.settings.rules.join('\n');
		if (key === 'editableText') return this.plugin.settings.editable.join(', ');
		return super.getControlValue(key);
	}
	async setControlValue(key: string, value: unknown): Promise<void> {
		if (['rulesText', 'editableText', 'kiosk'].includes(key)) {
			if (!isPro()) return;
			if (key === 'rulesText') this.plugin.settings = { ...this.plugin.settings, rules: String(value).split('\n').map((s) => s.trim()).filter(Boolean) };
			else if (key === 'editableText') this.plugin.settings = { ...this.plugin.settings, editable: String(value).split(/[,\n]/).map((s) => s.trim()).filter(Boolean) };
			else this.plugin.settings = { ...this.plugin.settings, kiosk: value === true };
			await this.plugin.saveAndRefresh();
			return;
		}
		await super.setControlValue(key, value);
	}
}
