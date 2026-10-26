import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI, isPro } from './pro';
import type KanbanEmbedPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface KanbanEmbedSettings {
	/** Width of one lane in pixels. */
	laneWidth: number;
	/** Hide checked cards in embeds that have no hide-done line. */
	hideDone: boolean;
	/** Swimlane rows the user folded, by embed: note path, boards and swimlane line make the key. */
	collapsedRows: Record<string, string[]>;
}

export const LANE_MIN = 180;
export const LANE_MAX = 480;

export const DEFAULT_SETTINGS: KanbanEmbedSettings = {
	laneWidth: 240,
	hideDone: false,
	collapsedRows: {},
};

/** Most embeds and rows the folded state keeps, so a hand-edited data.json cannot grow without bound. */
export const COLLAPSED_MAX_KEYS = 200;
export const COLLAPSED_MAX_ROWS = 100;

/** Keeps the folded rows that are lists of text, drops the rest and caps both sizes. */
export function normalizeCollapsed(saved: unknown): Record<string, string[]> {
	const out: Record<string, string[]> = {};
	if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return out;
	for (const [key, rows] of Object.entries(saved).slice(0, COLLAPSED_MAX_KEYS)) {
		if (!Array.isArray(rows)) continue;
		const list = (rows as unknown[]).filter((r): r is string => typeof r === 'string').slice(0, COLLAPSED_MAX_ROWS);
		if (list.length > 0) out[key] = [...new Set(list)];
	}
	return out;
}

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<KanbanEmbedSettings> | null | undefined): KanbanEmbedSettings {
	const s = saved ?? {};
	const w = typeof s.laneWidth === 'number' && Number.isFinite(s.laneWidth) ? Math.round(s.laneWidth) : DEFAULT_SETTINGS.laneWidth;
	return {
		laneWidth: Math.min(LANE_MAX, Math.max(LANE_MIN, w)),
		hideDone: typeof s.hideDone === 'boolean' ? s.hideDone : DEFAULT_SETTINGS.hideDone,
		collapsedRows: normalizeCollapsed(s.collapsedRows),
	};
}

export class KanbanEmbedSettingTab extends PluginSettingTab {
	plugin: KanbanEmbedPlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: KanbanEmbedPlugin) {
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
				name: 'Lane width',
				desc: `Width of one lane in pixels, from ${LANE_MIN} to ${LANE_MAX}. Lanes that do not fit scroll sideways.`,
				control: { type: 'slider', key: 'laneWidth', defaultValue: DEFAULT_SETTINGS.laneWidth, min: LANE_MIN, max: LANE_MAX, step: 20 },
			},
			{
				name: 'Hide done cards',
				desc: 'Hide checked cards in embeds that have no hide-done line.',
				control: { type: 'toggle', key: 'hideDone', defaultValue: DEFAULT_SETTINGS.hideDone },
			},
			{
				name: 'Pro features',
				desc: isPro()
					? 'Pro is on: move cards by drag and drop or the Move to menu, add cards, several boards in one embed, the card filter, and swimlane rows.'
					: 'Free version: one board per embed, lane picking, check off cards, live update. Pro adds moving cards, adding cards, several boards in one embed, the card filter, and swimlane rows.',
			},
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
		for (const e of this.plugin.embeds) e.schedule(0);
	}
}
