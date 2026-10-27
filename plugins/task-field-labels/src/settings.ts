import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { LABELS_LEAD, PRESETS_LEAD, PRO_UI, isPro, proNotice } from './pro';
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
				control: { type: 'text', key: 'label-' + f, defaultValue: LABELS[f] } })),
			{ name: 'Compact field layout (Pro)', desc: 'Reduce the space between supported fields.',  control: { type: 'toggle', key: 'compact', defaultValue: false } },
			{ name: 'Preset name (Pro)', desc: 'Name for the current custom labels and layout. Saving replaces a preset with this name.',  control: { type: 'text', key: 'presetName', defaultValue: '' } },
			{ name: 'Save display preset (Pro)',  render: (el) => {
				el.addButton((b) => b.setButtonText('Save preset').onClick(() => { if (!isPro()) { proNotice(PRESETS_LEAD); return; } this.plugin.savePreset(); this.update(); }));
			} },
			{ name: 'Display preset (Pro)', desc: 'Current labels uses the custom text above. A saved preset has its own copy.',  control: { type: 'dropdown', key: 'selectedPreset', defaultValue: '', options: { '': 'Current labels', ...Object.fromEntries(Object.keys(this.plugin.settings.presets).map((n) => [n, n])) } } },
			{ name: 'Folder rules (Pro)', desc: 'One rule per line: folder|preset name, or folder|off. The longest folder match uses the displayed note or report path.',  control: { type: 'textarea', key: 'folderRules', defaultValue: '' } },
		];
	}
	getControlValue(key: string): unknown {
		const field = FIELDS.find((f) => key === 'label-' + f);
		// A free user sees the values in effect: default labels, normal layout, no preset and no folder rules.
		// The stored Pro choices stay for the time that Pro comes back.
		if (key !== 'enabled' && !isPro()) return field ? LABELS[field] : key === 'compact' ? false : '';
		return field ? this.plugin.settings.labels[field] : super.getControlValue(key);
	}
	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key !== 'enabled' && !isPro()) {
			// Free users can select the Pro rows: the notice shows what Pro adds and how to get it. Nothing is saved.
			proNotice(key.startsWith('label-') || key === 'compact' ? LABELS_LEAD : PRESETS_LEAD);
			// Obsidian does not draw a control again while it has the focus. Move the focus out, then draw the tab
			// again, so the row shows the value in effect.
			const active = this.containerEl.ownerDocument.activeElement as HTMLElement | null;
			if (active && this.containerEl.contains(active)) active.blur();
			this.update();
			return;
		}
		const field = FIELDS.find((f) => key === 'label-' + f);
		if (field) { if (typeof value === 'string') this.plugin.settings.labels[field] = value; }
		else await super.setControlValue(key, value);
		await this.plugin.saveSettings();
	}
}
