import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI, isPro } from './pro';
import type PocketSymbolicSolverPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface PocketSymbolicSolverSettings {
	/** Time limit for one solve, in seconds. */
	timeoutSeconds: number;
	/** Keep a local history of solves in data.json. */
	keepHistory: boolean;
}

export interface SavedEquation {
	name: string;
	equation: string;
	symbol: string;
}

/** A named table of parameter values: first line names, next lines values. */
export interface ParamSet {
	name: string;
	table: string;
}

export interface HistoryEntry {
	equation: string;
	symbol: string;
	/** The inserted or previewed text, for example "$$a = \frac{F}{m}$$". */
	result: string;
	/** Time of the solve, ms since 1970. */
	at: number;
}

export interface PocketSymbolicSolverData {
	settings: PocketSymbolicSolverSettings;
	saved: SavedEquation[];
	paramSets: ParamSet[];
	history: HistoryEntry[];
}

export const TIMEOUT_MIN = 1;
export const TIMEOUT_MAX = 30;
export const HISTORY_MAX = 200;
export const SAVED_MAX = 200;

export const DEFAULT_SETTINGS: PocketSymbolicSolverSettings = {
	timeoutSeconds: 5,
	keepHistory: true,
};

const str = (v: unknown): v is string => typeof v === 'string';

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<PocketSymbolicSolverSettings> | null | undefined): PocketSymbolicSolverSettings {
	const s = saved ?? {};
	const t = typeof s.timeoutSeconds === 'number' && Number.isFinite(s.timeoutSeconds) ? Math.round(s.timeoutSeconds) : DEFAULT_SETTINGS.timeoutSeconds;
	return {
		timeoutSeconds: Math.min(TIMEOUT_MAX, Math.max(TIMEOUT_MIN, t)),
		keepHistory: typeof s.keepHistory === 'boolean' ? s.keepHistory : DEFAULT_SETTINGS.keepHistory,
	};
}

/** Reads data.json. Drops entries with wrong types. */
export function normalizeData(raw: unknown): PocketSymbolicSolverData {
	const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []);
	return {
		settings: normalizeSettings(d.settings as Partial<PocketSymbolicSolverSettings> | undefined),
		saved: list(d.saved)
			.filter((x) => str(x.name) && str(x.equation) && str(x.symbol))
			.map((x) => ({ name: x.name as string, equation: x.equation as string, symbol: x.symbol as string }))
			.slice(0, SAVED_MAX),
		paramSets: list(d.paramSets)
			.filter((x) => str(x.name) && str(x.table))
			.map((x) => ({ name: x.name as string, table: x.table as string }))
			.slice(0, SAVED_MAX),
		history: list(d.history)
			.filter((x) => str(x.equation) && str(x.symbol) && str(x.result) && typeof x.at === 'number')
			.map((x) => ({ equation: x.equation as string, symbol: x.symbol as string, result: x.result as string, at: x.at as number }))
			.slice(0, HISTORY_MAX),
	};
}

/** Adds or replaces (same name) an item at the top of a list. */
export function upsertByName<T extends { name: string }>(items: T[], item: T, max = SAVED_MAX): T[] {
	return [item, ...items.filter((x) => x.name !== item.name)].slice(0, max);
}

/** Adds a solve to the top of the history. The same equation and symbol move to the top, not in two places. */
export function addHistory(history: HistoryEntry[], entry: HistoryEntry, max = HISTORY_MAX): HistoryEntry[] {
	return [entry, ...history.filter((h) => !(h.equation === entry.equation && h.symbol === entry.symbol))].slice(0, max);
}

/** History entries that hold each word of the query (case-insensitive), newest first. */
export function searchHistory(history: HistoryEntry[], query: string): HistoryEntry[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	return history.filter((h) => {
		const text = `${h.equation} ${h.symbol} ${h.result}`.toLowerCase();
		return words.every((w) => text.includes(w));
	});
}

export class PocketSymbolicSolverSettingTab extends PluginSettingTab {
	plugin: PocketSymbolicSolverPlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: PocketSymbolicSolverPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		const d = this.plugin.data;
		return [
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
			{
				name: 'Time limit',
				desc: `Seconds that one solve can take before the plugin stops it, from ${TIMEOUT_MIN} to ${TIMEOUT_MAX}.`,
				control: { type: 'slider', key: 'timeoutSeconds', defaultValue: DEFAULT_SETTINGS.timeoutSeconds, min: TIMEOUT_MIN, max: TIMEOUT_MAX, step: 1 },
			},
			{
				name: 'Keep solve history',
				desc: `Store the last ${HISTORY_MAX} solves in the plugin data file in this vault. Searching the history is a Pro feature.`,
				control: { type: 'toggle', key: 'keepHistory', defaultValue: DEFAULT_SETTINGS.keepHistory },
			},
			{
				name: 'Clear solve history',
				desc: `${d.history.length} ${d.history.length === 1 ? 'solve' : 'solves'} in the history.`,
				action: () => {
					void this.plugin.clearHistory().then(() => this.update());
				},
			},
			{
				name: 'Pro features',
				desc: isPro()
					? 'Pro is on: saved equations, named parameter sets, tables of results and history search.'
					: 'Free version: solve for a symbol, preview the math and insert it. Pro adds saved equations, named parameter sets, a Markdown table of results for a table of parameter values, and history search.',
			},
		];
	}

	getControlValue(key: string): unknown {
		return (this.plugin.data.settings as unknown as Record<string, unknown>)[key];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		this.plugin.data.settings = normalizeSettings({ ...this.plugin.data.settings, [key]: value });
		await this.plugin.saveAll();
	}
}
