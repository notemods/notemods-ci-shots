import { Editor, Notice, Plugin } from 'obsidian';
import { countWords } from './core/index';
import { DEFAULT_SETTINGS, BasesCardWrapSettingTab, normalizeSettings, type BasesCardWrapSettings } from './settings';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

export default class BasesCardWrapPlugin extends Plugin {
	settings: BasesCardWrapSettings = { ...DEFAULT_SETTINGS };

	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		this.addSettingTab(new BasesCardWrapSettingTab(this.app, this));

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
		this.settings = normalizeSettings((await this.loadData()) as Partial<BasesCardWrapSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
