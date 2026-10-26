import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI, isPro } from './pro';
import type FountainReferencePanelPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface FountainReferencePanelSettings {
	/** Pro: project folders to scan, one for each line. Empty = the whole vault. */
	folders: string;
}

export const DEFAULT_SETTINGS: FountainReferencePanelSettings = {
	folders: '',
};

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<FountainReferencePanelSettings> | null | undefined): FountainReferencePanelSettings {
	const s = saved ?? {};
	return {
		folders: typeof s.folders === 'string' ? s.folders : DEFAULT_SETTINGS.folders,
	};
}

export class FountainReferencePanelSettingTab extends PluginSettingTab {
	plugin: FountainReferencePanelPlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: FountainReferencePanelPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
			{
				type: 'group',
				heading: 'Project folder filters (Pro)',
				items: [
					{
						name: 'Project folders',
						desc: isPro()
							? 'Scan only the .fountain files in these folders and their subfolders. Write one folder for each line. Leave it empty to scan the whole vault. Select Refresh in the panel after a change.'
							: 'Pro feature. Without Pro, the panel scans each .fountain file in the vault and ignores this list.',
						control: { type: 'textarea', key: 'folders', defaultValue: DEFAULT_SETTINGS.folders, placeholder: 'Scripts/Feature film', rows: 3, disabled: () => !isPro() },
					},
				],
			},
			{
				name: 'Pro features',
				desc: isPro()
					? 'Pro is on: saved project folder filters and the reference report for several selected notes.'
					: 'Free version: scan saved .fountain files, list the references to the active note with scene heading and nearby text, open the script and refresh. Pro adds saved project folder filters and a reference report for several selected notes.',
			},
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
	}
}
