import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { object, text } from './model';
import { PRO_UI } from './pro';
import type LocalApiPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface Saved { bookmarks: { source: string; endpoint: string }[]; filters: { name: string; tag: string }[] }
export function normalizeSaved(value: unknown): Saved {
	const o = object(value);
	return {
		bookmarks: Array.isArray(o.bookmarks) ? o.bookmarks.map(object).filter((x) => text(x.source) && text(x.endpoint)).map((x) => ({ source: text(x.source), endpoint: text(x.endpoint) })) : [],
		filters: Array.isArray(o.filters) ? o.filters.map(object).filter((x) => text(x.name) && text(x.tag)).map((x) => ({ name: text(x.name), tag: text(x.tag) })) : [],
	};
}
export class ReferenceSettings extends PluginSettingTab {
	constructor(private readonly owner: LocalApiPlugin) { super(owner.app, owner); }
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return this.owner.pro ? sponsorsSettingItems(this.owner.pro, PRO_UI) : [];
	}
}
