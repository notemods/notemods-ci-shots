import { PluginSettingTab, type Notice, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems, redrawKeepFocus } from './license/github-obsidian';
import { helloSettingItems } from './hello/settings';
import { PRO_UI, isPro, proNotice } from './pro';
import { parseFolders, type ListMode } from './links';
import type OneWayBacklinksPlugin from './main';

export interface OneWayBacklinksSettings {
	/** The list that a new pane shows first. */
	defaultList: ListMode;
	/** Pro: folders, one for each line. Backlinks from notes in them do not show. */
	hiddenFolders: string;
	/** True after the plugin added its pane to the right sidebar one time. A pane that the user closed stays closed. */
	paneAdded: boolean;
}

export const LISTS: Record<ListMode, string> = {
	'one-way': 'One-way',
	paired: 'Paired',
};

export const DEFAULT_SETTINGS: OneWayBacklinksSettings = {
	defaultList: 'one-way',
	hiddenFolders: '',
	paneAdded: false,
};

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<OneWayBacklinksSettings> | null | undefined): OneWayBacklinksSettings {
	const s = saved ?? {};
	return {
		defaultList: s.defaultList === 'one-way' || s.defaultList === 'paired' ? s.defaultList : DEFAULT_SETTINGS.defaultList,
		hiddenFolders: typeof s.hiddenFolders === 'string' ? s.hiddenFolders : DEFAULT_SETTINGS.hiddenFolders,
		paneAdded: typeof s.paneAdded === 'boolean' ? s.paneAdded : DEFAULT_SETTINGS.paneAdded,
	};
}

/** The hidden folders in effect. Without Pro: none. The stored text stays for the time that Pro comes back. */
export function effectiveHiddenFolders(settings: OneWayBacklinksSettings, pro: boolean): string[] {
	return pro ? parseFolders(settings.hiddenFolders) : [];
}

/** First sentences of the Pro notices. */
export const PRO_LEADS = {
	hiddenFolders: 'Hidden folders is a Pro feature.',
	linkBack: 'Link back is a Pro feature.',
} as const;

export class OneWayBacklinksSettingTab extends PluginSettingTab {
	/** The last Pro notice of this tab. The same notice does not show again while it is open. */
	private notice: Notice | null = null;
	plugin: OneWayBacklinksPlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: OneWayBacklinksPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: 'Default list',
				desc: 'The list that the pane shows when it opens. The two buttons at the top of the pane change it at any time.',
				control: { type: 'dropdown', key: 'defaultList', defaultValue: DEFAULT_SETTINGS.defaultList, options: { ...LISTS } },
			},
			{
				name: 'Hidden folders',
				desc: 'Pro. One folder on each line, for example Daily. Backlinks from notes in these folders and their subfolders do not show in either list.',
				control: { type: 'textarea', key: 'hiddenFolders', defaultValue: DEFAULT_SETTINGS.hiddenFolders, placeholder: 'Daily', rows: 3 },
			},
			{
				name: 'Pro features',
				desc: isPro()
					? 'Pro is on: the Link back button and the hidden folders work.'
					: 'Free version: the One-way and Paired lists with counts, live updates, a click to open a note and the hover preview. Pro adds a Link back button on each one-way backlink and the hidden folders.',
			},
			// The Pro group comes after the settings of the plugin.
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
		];
	}

	getControlValue(key: string): unknown {
		// A free user sees the value in effect. The stored text stays for the time that Pro comes back.
		if (key === 'hiddenFolders' && !isPro()) return '';
		return super.getControlValue(key);
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === 'hiddenFolders' && !isPro()) {
			// Free users can type in the Pro setting: the notice shows what Pro adds and how to get it. Nothing is saved.
			if (!this.notice?.messageEl.isConnected) this.notice = proNotice(PRO_LEADS.hiddenFolders);
			redrawKeepFocus(this);
			return;
		}
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
		this.plugin.refreshViews();
	}
}
