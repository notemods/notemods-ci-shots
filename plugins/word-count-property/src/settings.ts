import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { fillAccountSetting } from './license/github-obsidian';
import type WordCountPropertyPlugin from './main';
import { PRO_UI, SPONSOR_MONTHLY_URL, SPONSOR_ONE_TIME_URL } from './pro';
import { helloSettingItems } from './hello/settings';

export interface WordCountPropertySettings {
	countRenderedText: boolean;
	includeCodeBlocks: boolean;
}

export const DEFAULT_SETTINGS: WordCountPropertySettings = {
	countRenderedText: false,
	includeCodeBlocks: false,
};

export function normalizeSettings(saved: Partial<WordCountPropertySettings> | null | undefined): WordCountPropertySettings {
	const s = saved ?? {};
	return {
		countRenderedText: typeof s.countRenderedText === 'boolean' ? s.countRenderedText : DEFAULT_SETTINGS.countRenderedText,
		includeCodeBlocks: typeof s.includeCodeBlocks === 'boolean' ? s.includeCodeBlocks : DEFAULT_SETTINGS.includeCodeBlocks,
	};
}

export class WordCountPropertySettingTab extends PluginSettingTab {
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], private readonly plugin: WordCountPropertyPlugin) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: 'Get pro',
				visible: () => !this.plugin.isPro(),
				render: (setting) => {
					const fragment = createFragment();
					fragment.append(document.createTextNode(`${PRO_UI.proSummary} ${PRO_UI.priceText} `));
					const oneTime = createEl('a');
					oneTime.href = SPONSOR_ONE_TIME_URL;
					oneTime.textContent = '$15 one time';
					fragment.append(oneTime, document.createTextNode(' or '));
					const monthly = createEl('a');
					monthly.href = SPONSOR_MONTHLY_URL;
					monthly.textContent = '$5 a month';
					fragment.append(monthly);
					setting.setDesc(fragment);
				},
			},
			{
				name: 'GitHub account',
				render: (setting) => this.plugin.pro ? fillAccountSetting(setting, this.plugin.pro) : undefined,
			},
			{
				name: 'Preview rendered text',
				desc: 'Pro: the Show local reading preview command skips display syntax. Stored properties always count source text.',
				render: (setting) => {
					setting.addToggle((toggle) => toggle
						.setValue(this.plugin.settings.countRenderedText)
						.setDisabled(!this.plugin.isPro())
						.onChange((value) => void this.plugin.setRenderedText(value)));
				},
			},
			{
				name: 'Preview code',
				desc: 'Pro: include inline and fenced code in the local rendered preview. This does not change stored properties.',
				visible: () => this.plugin.isPro() && this.plugin.settings.countRenderedText,
				render: (setting) => {
					setting.addToggle((toggle) => toggle
						.setValue(this.plugin.settings.includeCodeBlocks)
						.setDisabled(!this.plugin.isPro())
						.onChange((value) => void this.plugin.setCodeBlocks(value)));
				},
			},
		];
	}
}
