import { Editor, Notice, Plugin } from 'obsidian';
import { countWords } from './core/index';
import { DEFAULT_SETTINGS, RelativeImageWidthSettingTab, normalizeSettings, type RelativeImageWidthSettings } from './settings';

export default class RelativeImageWidthPlugin extends Plugin {
	settings: RelativeImageWidthSettings = { ...DEFAULT_SETTINGS };

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new RelativeImageWidthSettingTab(this.app, this));

		this.addCommand({
			id: 'count-words',
			name: 'Count words in the current note',
			editorCallback: (editor: Editor) => {
				const { words } = countWords(editor.getValue());
				new Notice(this.settings.prefix + String(words));
			},
		});
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<RelativeImageWidthSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
