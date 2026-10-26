import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import SyncChurnWatchPlugin from '../src/main';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import { bindPro, isPro, resetPro, SPONSORS } from '../src/pro';
import { savedSessions } from '../src/storage';
import { fixture } from './fixture';
import manifest from '../manifest.json';

afterEach(() => { resetPro(); vi.restoreAllMocks(); });
function plugin(pro = false) {
	const app = App.createConfigured__({ files: { 'A.md': 'hello' } });
	const p = new SyncChurnWatchPlugin(app as never, manifest as never);
	const f = fixture(); p.watch = f.watch; p.redraw = vi.fn();
	bindPro({ isPro: () => pro, getState: () => ({ status: 'signed-out', lastAttemptAt: 0 }), hasToken: () => false, config: { sponsorLogin: 'theluckystrike' }, onChange: () => () => {} } as never);
	vi.spyOn(p, 'saveData').mockResolvedValue();
	return { p, f };
}
describe('plugin lifecycle and Pro', () => {
	it('loads defaults', async () => { const { p } = plugin(); await p.loadSettings(); expect(p.settings).toEqual(DEFAULT_SETTINGS); });
	it('repairs bad settings', () => {
		expect(normalizeSettings({ threshold: NaN, alerts: 'x' })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ threshold: -4, alerts: true })).toEqual({ threshold: 1, alerts: true });
	});
	it('saves once on stop with free results but no history', async () => {
		const { p, f } = plugin(); await p.startSession(); f.watch.observe('A.md', 'A.md', 'vault', 2000); f.time(10_000);
		await Promise.all([p.stopSession(), p.stopSession()]); await p.stopSession();
		expect(p.saveData).toHaveBeenCalledTimes(1); expect(p.history).toEqual([]); expect(f.watch.session!.rows[0]!.writes).toBe(1);
	});
	it('polls on the ten second clock and stops polling after stop', async () => {
		vi.useFakeTimers();
		const { p, f } = plugin();
		const path = '.obsidian/plugins/test/data.json'; f.put(path, 0);
		try {
			await p.startSession(); f.put(path, 1);
			await vi.advanceTimersByTimeAsync(9999);
			expect(f.watch.session!.rows[0]!.writes).toBe(0);
			await vi.advanceTimersByTimeAsync(1);
			expect(f.watch.session!.rows[0]!.writes).toBe(1);
			await p.stopSession(); const calls = f.adapter.stat.mock.calls.length;
			await vi.advanceTimersByTimeAsync(30_000);
			expect(f.adapter.stat).toHaveBeenCalledTimes(calls);
		} finally { p.onunload(); vi.useRealTimers(); }
	});
	it('does not save while running or on unload', async () => {
		const { p } = plugin(); await p.startSession(); p.onunload(); expect(p.saveData).not.toHaveBeenCalled(); expect(p.watch.active).toBe(false);
	});
	it('retains at most 30 Pro sessions', async () => {
		const { p, f } = plugin(true);
		for (let n = 0; n < 32; n++) { f.time(n * 1000); await p.startSession(); f.watch.observe('A.md', 'A.md', 'vault', 2); await p.stopSession(); }
		expect(p.history).toHaveLength(30); expect(p.saveData).toHaveBeenCalledTimes(32); expect(isPro()).toBe(true);
	});
	it('blocks folder copy without Pro', async () => {
		const { p, f } = plugin(); await f.watch.start(); f.watch.observe('Notes/A.md', 'A', 'vault', 1);
		const clipboard = vi.fn(); Object.defineProperty(navigator, 'clipboard', { value: { writeText: clipboard }, configurable: true });
		await p.copyExclusions(); expect(clipboard).not.toHaveBeenCalled();
	});
	it('copies folders only after the sponsor check', async () => {
		const { p, f } = plugin(true); await f.watch.start(); f.watch.observe('Notes/A.md', 'A', 'vault', 1);
		const clipboard = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { value: { writeText: clipboard }, configurable: true });
		await p.copyExclusions(); expect(clipboard).toHaveBeenCalledWith('Notes');
	});
	it('rejects bad sessions and keeps valid rows', () => {
		expect(savedSessions([null, { started: NaN }, { started: 2, stopped: 1, rows: [] }])).toEqual([]);
		expect(savedSessions([{ started: 0, stopped: 100, rows: [null, { path: 'A', name: 'A', group: 'vault', writes: 1, bytes: 2 }], days: { bad: 1, '2026-10-12': 3 } }])[0]).toEqual({ started: 0, stopped: 100, rows: [{ path: 'A', name: 'A', group: 'vault', writes: 1, bytes: 2 }], days: { '2026-10-12': 3 } });
	});
	it('uses the reference sponsor terms', () => { expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', minMonthlyUsd: 5, oneTimeUsd: 15, oneTimeMonths: 0 }); });
});
