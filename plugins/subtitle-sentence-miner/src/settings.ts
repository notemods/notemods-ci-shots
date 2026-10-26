import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI } from './pro';
import { validateTemplate, type CardTemplate } from './cards';
import type SubtitleSentenceMinerPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface SubtitleSentenceMinerSettings { outputPath: string; templates: CardTemplate[] }
export const DEFAULT_SETTINGS: SubtitleSentenceMinerSettings = { outputPath: 'Sentence cards/Subtitle cards.md', templates: [] };

export function normalizeSettings(saved: unknown): SubtitleSentenceMinerSettings {
	const s = saved && typeof saved === 'object' ? saved as Partial<SubtitleSentenceMinerSettings> : {};
	const templates: CardTemplate[] = [];
	if (Array.isArray(s.templates)) for (const item of s.templates) {
		if (!item || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80 || typeof item.body !== 'string') continue;
		try { validateTemplate(item.body); } catch { continue; }
		if (!templates.some((t) => t.name === item.name)) templates.push({ name: item.name, body: item.body });
		if (templates.length === 30) break;
	}
	return { outputPath: typeof s.outputPath === 'string' && s.outputPath.trim() ? s.outputPath : DEFAULT_SETTINGS.outputPath, templates };
}

export class SubtitleSentenceMinerSettingTab extends PluginSettingTab {
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], readonly plugin: SubtitleSentenceMinerPlugin) { super(app, plugin); }

	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
			{ name: 'Output path', desc: 'Default path for a new Markdown note. An existing path gets a number.', control: { type: 'text', key: 'outputPath', defaultValue: DEFAULT_SETTINGS.outputPath } },
			{ name: 'Saved card templates (Pro)', desc: 'Create templates in the cue list. Clear saved templates here.', render: (setting) => {
				setting.addButton((button) => button.setButtonText('Clear templates').onClick(async () => {
					this.plugin.settings.templates = [];
					await this.plugin.saveSettings();
					this.update();
				}));
			} },
		];
	}
}
