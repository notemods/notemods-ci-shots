import { Editor, Notice, Plugin } from 'obsidian';
import type { HeadingCaseMode } from './core/index';
import { planHeadingEdit, type LineRange } from './apply';
import { DEFAULT_SETTINGS, HeadingCaseSettingTab, keepList, normalizeSettings, type HeadingCaseSettings } from './settings';

export default class HeadingCasePlugin extends Plugin {
	settings: HeadingCaseSettings = { ...DEFAULT_SETTINGS };

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new HeadingCaseSettingTab(this.app, this));

		this.addCommand({
			id: 'convert-headings-sentence-case',
			name: 'Convert headings to sentence case',
			editorCallback: (editor: Editor) => this.convert(editor, 'sentence'),
		});
		this.addCommand({
			id: 'convert-headings-title-case',
			name: 'Convert headings to title case',
			editorCallback: (editor: Editor) => this.convert(editor, 'title'),
		});
	}

	/** Re-cases headings in one undoable transaction and reports what changed. */
	convert(editor: Editor, mode: HeadingCaseMode): string {
		const range = this.selectedLines(editor);
		const edit = planHeadingEdit(editor.getValue(), mode, keepList(this.settings), range);
		if (edit.changes.length > 0) editor.transaction({ changes: edit.changes });
		new Notice(edit.message);
		return edit.message;
	}

	private selectedLines(editor: Editor): LineRange | null {
		if (!this.settings.selectionOnly || !editor.somethingSelected()) return null;
		const from = editor.getCursor('from').line;
		const to = editor.getCursor('to').line;
		return { from: Math.min(from, to), to: Math.max(from, to) };
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<HeadingCaseSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
