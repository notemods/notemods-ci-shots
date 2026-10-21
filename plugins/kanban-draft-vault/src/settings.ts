import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI } from './pro';
import type KanbanDraftVaultPlugin from './main';
import { helloSettingItems } from './hello/settings';

export class KanbanDraftVaultSettingTab extends PluginSettingTab {
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], readonly draftPlugin: KanbanDraftVaultPlugin) { super(app, draftPlugin); }
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: 'Local draft capture', desc: 'Capture starts in the Kanban new-card form. Open draft recovery from the command palette to copy or dismiss text. A forced app stop can lose text that has not been saved.' },
			...(this.draftPlugin.pro ? sponsorsSettingItems(this.draftPlugin.pro, PRO_UI) : []),
		];
	}
}
