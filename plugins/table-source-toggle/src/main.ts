import { Editor, Notice, Plugin } from 'obsidian';
import { countWords } from './core/index';
import { DEFAULT_SETTINGS, TableSourceToggleSettingTab, normalizeSettings, type TableSourceToggleSettings } from './settings';

export default class TableSourceTogglePlugin extends Plugin {
	settings: TableSourceToggleSettings = { ...DEFAULT_SETTINGS };

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new TableSourceToggleSettingTab(this.app, this));

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
		this.settings = normalizeSettings((await this.loadData()) as Partial<TableSourceToggleSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
