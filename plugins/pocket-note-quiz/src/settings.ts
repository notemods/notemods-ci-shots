import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI, isPro } from './pro';
import type PocketNoteQuizPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface Preset { name: string; marker: string }
export interface PocketNoteQuizSettings { marker: string; presets: Preset[] }
export const DEFAULT_SETTINGS: PocketNoteQuizSettings = { marker: '?', presets: [] };
export function normalizeSettings(saved: Partial<PocketNoteQuizSettings> | null | undefined): PocketNoteQuizSettings {
	const s = saved ?? {};
	return {
		marker: typeof s.marker === 'string' && s.marker.trim() ? s.marker : '?',
		presets: Array.isArray(s.presets) ? s.presets.filter((p): p is Preset => !!p && typeof p.name === 'string' && !!p.name.trim() && typeof p.marker === 'string' && !!p.marker.trim()).map((p) => ({ name: p.name, marker: p.marker })) : [],
	};
}
export class PocketNoteQuizSettingTab extends PluginSettingTab {
	plugin: PocketNoteQuizPlugin;
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: PocketNoteQuizPlugin) {
		super(app, plugin); this.plugin = plugin;
	}
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: 'Question marker', desc: 'A question line contains this text. A blank value uses ?.', control: { type: 'text', key: 'marker', defaultValue: '?' } },
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
			{ name: 'Named question-marker presets (Pro)', desc: 'Save the current marker with a name. Select a saved name to use its marker.', render: (setting) => {
				let name = '';
				setting.addText((t) => t.setPlaceholder('Preset name').onChange((v) => { name = v; }));
				setting.addButton((b) => b.setButtonText('Save preset').setDisabled(!isPro()).onClick(async () => { await this.plugin.addPreset(name, this.plugin.settings.marker); this.update(); }));
				for (const p of this.plugin.settings.presets) setting.addButton((b) => b.setButtonText(p.name).setDisabled(!isPro()).onClick(async () => { await this.plugin.usePreset(p.name); this.update(); }));
			} },
		];
	}
	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
		await this.plugin.saveSettings();
	}
}
