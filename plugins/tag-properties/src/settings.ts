import { PluginSettingTab, type App, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import type TagPropertiesPlugin from './main';
import { PRO_UI } from './pro';
import { helloSettingItems } from './hello/settings';

export interface TagPropertiesSettings { properties: string; includeCore: boolean }
export const DEFAULT_SETTINGS: TagPropertiesSettings = { properties: 'topics', includeCore: false };
export function normalizeSettings(saved: Partial<TagPropertiesSettings> | null | undefined): TagPropertiesSettings {
	return { properties: typeof saved?.properties === 'string' ? saved.properties : 'topics', includeCore: saved?.includeCore === true };
}
export class TagPropertiesSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly host: TagPropertiesPlugin) { super(app, host); }
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: 'Tag properties', desc: 'Comma-separated list property names. Free uses the first name. Pro uses all names. The core tags property is separate.', control: { type: 'text', key: 'properties', defaultValue: 'topics' } },
			{ name: 'Include core tags', desc: 'Pro combines core and custom tags in this plugin’s view. The core tag pane is unchanged.', control: { type: 'toggle', key: 'includeCore', defaultValue: false } },
			...(!this.host.isPro() ? [{ name: 'Pro offer', render: (setting) => {
				setting.descEl.createEl('a', { text: '$15 one time or $5 a month', href: 'https://github.com/sponsors/theluckystrike/sponsorships?tier_id=666162&metadata_source=tag-properties' });
			} } satisfies SettingDefinitionItem] : []),
			...(this.host.pro ? sponsorsSettingItems(this.host.pro, PRO_UI) : []),
		];
	}
	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		this.host.refresh();
	}
}
