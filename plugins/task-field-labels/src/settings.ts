import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI, isPro } from './pro';
import { FIELDS, LABELS } from './fields';
import type TaskFieldLabelsPlugin from './main';
import { helloSettingItems } from './hello/settings';
export { DEFAULT_SETTINGS, normalizeSettings } from './options';

export class TaskFieldLabelsSettingTab extends PluginSettingTab {
	declare plugin: TaskFieldLabelsPlugin;
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: 'Show field labels', desc: 'Use fixed English labels in supported Tasks fields. Turn off to restore icons.', control: { type: 'toggle', key: 'enabled', defaultValue: true } },
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
			...FIELDS.map((f): SettingDefinitionItem => ({ name: LABELS[f] + ' label (Pro)', desc: 'Plain text, from 1 to 40 characters. Includes a colon when displayed.',
				control: { disabled: () => !isPro(), type: 'text', key: 'label-' + f, defaultValue: LABELS[f] } })),
			{ name: 'Compact field layout (Pro)', desc: 'Reduce the space between supported fields.',  control: { disabled: () => !isPro(), type: 'toggle', key: 'compact', defaultValue: false } },
			{ name: 'Preset name (Pro)', desc: 'Name for the current custom labels and layout. Saving replaces a preset with this name.',  control: { disabled: () => !isPro(), type: 'text', key: 'presetName', defaultValue: '' } },
			{ name: 'Save display preset (Pro)',  render: (el) => {
				el.addButton((b) => b.setButtonText('Save preset').setDisabled(!isPro()).onClick(() => { this.plugin.savePreset(); this.update(); }));
			} },
			{ name: 'Display preset (Pro)', desc: 'Current labels uses the custom text above. A saved preset has its own copy.',  control: { disabled: () => !isPro(), type: 'dropdown', key: 'selectedPreset', defaultValue: '', options: { '': 'Current labels', ...Object.fromEntries(Object.keys(this.plugin.settings.presets).map((n) => [n, n])) } } },
			{ name: 'Folder rules (Pro)', desc: 'One rule per line: folder|preset name, or folder|off. The longest folder match uses the displayed note or report path.',  control: { disabled: () => !isPro(), type: 'textarea', key: 'folderRules', defaultValue: '' } },
		];
	}
	getControlValue(key: string): unknown {
		const field = FIELDS.find((f) => key === 'label-' + f);
		return field ? this.plugin.settings.labels[field] : super.getControlValue(key);
	}
	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key !== 'enabled' && !isPro()) return;
		const field = FIELDS.find((f) => key === 'label-' + f);
		if (field) { if (typeof value === 'string') this.plugin.settings.labels[field] = value; }
		else await super.setControlValue(key, value);
		await this.plugin.saveSettings();
	}
}
