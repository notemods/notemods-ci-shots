import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI } from './pro';
import { readTree, type SceneArray } from './tree';
import type SceneSubtreeMoverPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface SavedOrder {
	name: string;
	indexPath: string;
	scenes: SceneArray;
	savedAt: string;
}
export interface SceneSubtreeMoverSettings {
	orders: SavedOrder[];
}
export const DEFAULT_SETTINGS: SceneSubtreeMoverSettings = { orders: [] };

export function normalizeSettings(value: unknown): SceneSubtreeMoverSettings {
	const result: SceneSubtreeMoverSettings = { orders: [] };
	if (typeof value !== 'object' || value === null || !('orders' in value) || !Array.isArray(value.orders)) return result;
	for (const item of value.orders as unknown[]) {
		if (typeof item !== 'object' || item === null) continue;
		const order = item as Partial<SavedOrder>;
		if (typeof order.name !== 'string' || !order.name.trim() || order.name.length > 120 || typeof order.indexPath !== 'string' || !order.indexPath || typeof order.savedAt !== 'string') continue;
		try {
			readTree(order.scenes);
			result.orders.push({ name: order.name, indexPath: order.indexPath, scenes: order.scenes!, savedAt: order.savedAt });
		} catch {
			// Skip invalid saved data. The source index is not changed.
		}
	}
	return result;
}

export class SceneSubtreeMoverSettingTab extends PluginSettingTab {
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], readonly plugin: SceneSubtreeMoverPlugin) {
		super(app, plugin);
	}
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: 'Source backups', desc: 'A full source backup with the .md.bak extension is created beside the index before a changed order is applied. Keep it until you have checked the manuscript.' },
			{ name: 'Saved orders', desc: `${this.plugin.settings.orders.length} named orders in local plugin data. Open an index and use the mover to save or restore an order.` },
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
		];
	}
}
