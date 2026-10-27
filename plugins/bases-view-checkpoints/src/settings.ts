import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI } from './pro';
import type BasesViewCheckpointsPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface CheckpointsSettings {
	/** True = no data yet; false = at least one checkpoint was saved. */
	empty: boolean;
}

export const DEFAULT_SETTINGS: CheckpointsSettings = { empty: true };

/** Fills gaps from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<CheckpointsSettings> | null | undefined): CheckpointsSettings {
	const s = saved ?? {};
	return { empty: typeof s.empty === 'boolean' ? s.empty : DEFAULT_SETTINGS.empty };
}

export class BasesViewCheckpointsSettingTab extends PluginSettingTab {
	plugin: BasesViewCheckpointsPlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: BasesViewCheckpointsPlugin) {
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
				name: 'Pro features',
				desc: isProText(),
			},
		];
	}
}

function isProText(): string {
	return 'Free version: one checkpoint for each view, restore with a preview, and undo of the last restore. Pro adds several named checkpoints for each view and a compare command that lists the keys a checkpoint would change.';
}
