import { describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import PocketSymbolicSolverPlugin, { equationFromSelection } from '../src/main';
import { DEFAULT_SETTINGS, HISTORY_MAX, addHistory, normalizeData, normalizeSettings, searchHistory, upsertByName, type HistoryEntry } from '../src/settings';
import manifest from '../manifest.json';

describe('PocketSymbolicSolverPlugin', () => {
	it('loads empty data against an in-memory vault', async () => {
		const app = App.createConfigured__({ files: { 'notes/a.md': '# Hello world' } });
		const plugin = new PocketSymbolicSolverPlugin(app as never, manifest as never);
		plugin.loadData = async () => null;
		await plugin.loadAll();
		expect(plugin.data).toEqual({ settings: DEFAULT_SETTINGS, saved: [], paramSets: [], history: [] });
	});

	it('does not record history when the setting is off', async () => {
		const app = App.createConfigured__({ files: {} });
		const plugin = new PocketSymbolicSolverPlugin(app as never, manifest as never);
		let saved = 0;
		plugin.saveData = async () => {
			saved++;
		};
		plugin.data = normalizeData({ settings: { keepHistory: false } });
		await plugin.recordHistory('F=m*a', 'a', '$$a = \\frac{F}{m}$$');
		expect(plugin.data.history).toEqual([]);
		expect(saved).toBe(0);
		plugin.data.settings.keepHistory = true;
		await plugin.recordHistory(' F=m*a ', 'a', '$$a = \\frac{F}{m}$$');
		expect(plugin.data.history.map((h) => h.equation)).toEqual(['F=m*a']);
		expect(saved).toBe(1);
	});

	it('repairs bad saved settings and clamps the time limit', () => {
		expect(normalizeSettings({ timeoutSeconds: 'x' as never, keepHistory: 3 as never })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ timeoutSeconds: 0 }).timeoutSeconds).toBe(1);
		expect(normalizeSettings({ timeoutSeconds: 99 }).timeoutSeconds).toBe(30);
	});

	it('drops data entries with wrong types', () => {
		const d = normalizeData({ saved: [{ name: 'a', equation: 'x=1', symbol: 'x' }, { name: 1 }, null], paramSets: 'bad', history: [{ equation: 'x=1', symbol: 'x', result: '$$x = 1$$', at: 5 }, { equation: 'x' }] });
		expect(d.saved).toEqual([{ name: 'a', equation: 'x=1', symbol: 'x' }]);
		expect(d.paramSets).toEqual([]);
		expect(d.history).toHaveLength(1);
	});
});

describe('history and saved lists', () => {
	const h = (equation: string, at: number): HistoryEntry => ({ equation, symbol: 'x', result: `$$${equation}$$`, at });
	it('moves a repeated solve to the top and keeps the limit', () => {
		let list: HistoryEntry[] = [];
		for (let i = 0; i < HISTORY_MAX + 5; i++) list = addHistory(list, h(`x=${i}`, i));
		expect(list).toHaveLength(HISTORY_MAX);
		list = addHistory(list, h('x=150', 999));
		expect(list[0]!.at).toBe(999);
		expect(list.filter((e) => e.equation === 'x=150')).toHaveLength(1);
	});
	it('replaces a saved item with the same name', () => {
		const list = upsertByName(upsertByName([], { name: 'Force', table: 'a' }), { name: 'Force', table: 'b' });
		expect(list).toEqual([{ name: 'Force', table: 'b' }]);
	});
	it('search is case-insensitive and an empty query gives each entry', () => {
		const list = [h('F=m*a', 1), h('v=u+a*t', 2)];
		expect(searchHistory(list, 'f=M')).toHaveLength(1);
		expect(searchHistory(list, '')).toHaveLength(2);
	});
});

describe('equationFromSelection', () => {
	it('removes $ signs and line breaks', () => {
		expect(equationFromSelection('$F=m*a$')).toBe('F=m*a');
		expect(equationFromSelection('$$\nv=u+a*t\n$$')).toBe('v=u+a*t');
		expect(equationFromSelection('  x^2-5*x+6=0 ')).toBe('x^2-5*x+6=0');
		expect(equationFromSelection('`F=m*a`')).toBe('F=m*a');
	});
});
