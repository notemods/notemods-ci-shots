import { Notice, Plugin, type Editor } from 'obsidian';
import { LINE_BREAKS } from './enter';
import { paragraphEnterExtension } from './editor';
import { DEFAULT_SETTINGS, ParagraphEnterSettingTab, normalizeSettings, type ParagraphEnterSettings } from './settings';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

export const TOGGLE_COMMAND = 'Toggle paragraph Enter';
export const WELCOME = `Paragraph Enter is on. Enter now starts a new paragraph and Shift+Enter makes a line break. To undo this, run "${TOGGLE_COMMAND}" from the command palette.`;

export default class ParagraphEnterPlugin extends Plugin {
	settings: ParagraphEnterSettings = { ...DEFAULT_SETTINGS };
	statusEl: HTMLElement | null = null;

	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		this.addSettingTab(new ParagraphEnterSettingTab(this.app, this));
		this.registerEditorExtension(paragraphEnterExtension({
			enabled: () => this.settings.enabled,
			lineBreakStyle: () => this.settings.lineBreakStyle,
		}));

		this.addCommand({ id: 'toggle', name: TOGGLE_COMMAND, callback: () => void this.toggle() });
		this.addCommand({
			id: 'insert-line-break',
			name: 'Insert line break',
			editorCallback: (editor: Editor) => this.insertLineBreak(editor),
		});

		const status = this.addStatusBarItem();
		status.addClass('paragraph-enter-status', 'mod-clickable');
		status.setText('¶');
		this.registerDomEvent(status, 'click', () => void this.toggle());
		this.statusEl = status;
		this.refreshStatus();

		if (!this.settings.welcomed) {
			this.settings.welcomed = true;
			await this.saveSettings();
			this.notify(WELCOME, 15000);
		}
	}

	onunload(): void { this.statusEl = null; }

	async toggle(): Promise<void> {
		this.settings.enabled = !this.settings.enabled;
		await this.saveSettings();
		this.refreshStatus();
		this.notify(this.settings.enabled ? 'Enter starts a new paragraph.' : 'Enter adds one line break, as in Obsidian without this plugin.');
	}

	notify(message: string, duration?: number): void {
		new Notice(message, duration);
	}

	insertLineBreak(editor: Editor): void {
		editor.replaceSelection(LINE_BREAKS[this.settings.lineBreakStyle]);
	}

	refreshStatus(): void {
		const el = this.statusEl;
		if (!el) return;
		const on = this.settings.enabled;
		el.toggleClass('is-off', !on);
		el.setAttribute('aria-label', on ? 'Enter starts a new paragraph. Select to turn it off.' : 'Enter adds one line break. Select to start paragraphs with Enter.');
		el.setAttribute('data-tooltip-position', 'top');
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<ParagraphEnterSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
