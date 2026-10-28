import { PluginSettingTab, type Notice, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems, redrawKeepFocus } from './license/github-obsidian';
import { PRO_NAMED, PRO_STYLE, PRO_UI, isPro, proNotice } from './pro';
import type RevisionSessionMarksPlugin from './main';
import { helloSettingItems } from './hello/settings';

export class RevisionSessionMarksSettingTab extends PluginSettingTab {
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], readonly plugin: RevisionSessionMarksPlugin) { super(app, plugin); }
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: 'Baseline name (Pro)', desc: 'Name used by the named baseline and folder commands. One name can be used for several notes.', control: { type: 'text', key: 'baselineName', defaultValue: 'First draft' } },
			{ name: 'Author label (Pro)', desc: 'Optional label in a CriticMarkup comment. Maximum 80 characters.', control: { type: 'text', key: 'author', defaultValue: '' } },
			{ name: 'Change summary (Pro)', desc: 'Add the number of addition, deletion and substitution marks in a comment.', control: { type: 'toggle', key: 'includeSummary', defaultValue: false } },
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
		];
	}
	/** The last Pro notice of this tab. A second notice does not show while it is open. */
	private notice: Notice | null = null;

	getControlValue(key: string): unknown {
		// A free user sees the values in effect without Pro. The stored choice stays for the time that Pro comes back.
		if (!isPro()) {
			if (key === 'baselineName') return 'First draft';
			if (key === 'author') return '';
			if (key === 'includeSummary') return false;
		}
		return super.getControlValue(key);
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const lead = key === 'baselineName' ? PRO_NAMED : key === 'author' || key === 'includeSummary' ? PRO_STYLE : null;
		if (lead && !isPro()) {
			// A free user selected a Pro setting: tell how to get Pro and save nothing. Move the focus out, then draw the
			// tab again, so the control shows the value in effect (Obsidian does not draw a focused control again).
			if (!this.notice?.messageEl.isConnected) this.notice = proNotice(lead);
			redrawKeepFocus(this);
			return;
		}
		if ((key === 'baselineName' || key === 'author') && typeof value === 'string') this.plugin.settings[key] = value.slice(0, 80);
		if (key === 'includeSummary' && typeof value === 'boolean') this.plugin.settings.includeSummary = value;
		await this.plugin.saveSettings();
	}
}
