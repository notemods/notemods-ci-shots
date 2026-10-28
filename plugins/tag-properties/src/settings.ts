import { PluginSettingTab, type App, type Notice, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems, redrawKeepFocus } from './license/github-obsidian';
import type TagPropertiesPlugin from './main';
import { PRO_CORE, PRO_SEVERAL, PRO_UI, proNotice } from './pro';
import { activeProperties } from './tags';
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
	/** The last Pro notice of this tab. A second notice does not show while it is open. */
	private notice: Notice | null = null;
	private refuse(lead: string): void { if (!this.notice?.messageEl.isConnected) this.notice = proNotice(lead); }

	getControlValue(key: string): unknown {
		// A free user sees the value in effect: core tags are not in the view. The stored choice stays for Pro.
		if (key === 'includeCore' && !this.host.isPro()) return false;
		return super.getControlValue(key);
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === 'includeCore' && !this.host.isPro()) {
			// A free user selected a Pro toggle: tell how to get Pro and save nothing. Move the focus out, then draw the
			// tab again, so the toggle shows off (Obsidian does not draw a focused control again).
			this.refuse(PRO_CORE);
			redrawKeepFocus(this);
			return;
		}
		await super.setControlValue(key, value);
		// The first tag property is free and saves. More names need Pro: tell a free user once while the notice shows.
		if (key === 'properties' && !this.host.isPro() && activeProperties(value, true).length > 1) this.refuse(PRO_SEVERAL);
		this.host.refresh();
	}
}
