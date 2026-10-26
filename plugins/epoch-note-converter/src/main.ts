import { Notice, Plugin, type Editor } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { SPONSORS, PRO_UI, bindPro, isPro, proNotice, resetPro } from './pro';
import { DEFAULT_SETTINGS, EpochNoteConverterSettingTab, normalizeSettings, type EpochNoteConverterSettings } from './settings';
import { snapshot } from './edit';
import { ConverterModal } from './modal';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

export default class EpochNoteConverterPlugin extends Plugin {
	settings: EpochNoteConverterSettings = { ...DEFAULT_SETTINGS };
	pro: SponsorsManager | null = null;
	private settingTab: EpochNoteConverterSettingTab | null = null;
	readonly previews = new Set<ConverterModal>();

	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		this.settingTab = new EpochNoteConverterSettingTab(this.app, this);
		this.register(pro.onChange(() => this.settingTab?.update()));
		this.addSettingTab(this.settingTab);
		this.addCommand({ id: 'convert-selection', name: 'Convert selected timestamp', editorCallback: (editor: Editor) => this.openConverter(editor) });
		this.addCommand({ id: 'convert-column', name: PRO_UI.columnCommand, editorCallback: (editor: Editor) => this.openConverter(editor, true) });
		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
		});
	}

	openConverter(editor: Editor, batch = false): void {
		if (batch && !isPro()) {
			proNotice(PRO_UI.columnNotice);
			return;
		}
		if (editor.listSelections().length !== 1 || !editor.getSelection()) {
			new Notice('Select one timestamp or one continuous column first.');
			return;
		}
		const modal = new ConverterModal(this, editor, snapshot(editor), batch);
		this.previews.add(modal);
		modal.open();
	}

	onunload(): void {
		for (const preview of this.previews) preview.close();
		resetPro();
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<EpochNoteConverterSettings> | null);
	}
	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
