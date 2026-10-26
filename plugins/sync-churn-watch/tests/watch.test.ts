import { describe, expect, it } from 'vitest';
import { dailyHistory, exclusionFolders, markdown, rate } from '../src/watch';
import { fixture } from './fixture';

const path = '.obsidian/plugins/test/data.json';
describe('watch session', () => {
	it('does no reads or counts before start', async () => {
		const f = fixture(); f.put(path, 1); await f.watch.poll(); f.watch.observe('A.md', 'A.md', 'vault', 2000);
		expect(f.adapter.stat).not.toHaveBeenCalled(); expect(f.watch.session).toBeNull();
	});
	it('reads the manifest name and counts three separate polled writes', async () => {
		const f = fixture(); f.put(path, 0); f.manifests.set('.obsidian/plugins/test/manifest.json', '{"name":"Test plugin"}');
		await f.watch.start();
		for (let n = 1; n <= 3; n++) { f.time(n * 15_000); f.put(path, n, 50 * n); await f.watch.poll(); }
		expect(f.watch.session!.rows).toEqual([{ path, name: 'Test plugin', group: 'settings', writes: 3, bytes: 300 }]);
	});
	it('counts two writes between polls once and skips unchanged mtimes', async () => {
		const f = fixture(); f.put(path, 0); await f.watch.start(); f.put(path, 1); f.put(path, 2); await f.watch.poll(); await f.watch.poll();
		expect(f.watch.session!.rows[0]!.writes).toBe(1);
	});
	it('adds the size of each note write', async () => {
		const f = fixture(); await f.watch.start();
		for (let n = 0; n < 4; n++) f.watch.observe('A.md', 'A.md', 'vault', 2000);
		expect(f.watch.session!.rows[0]).toMatchObject({ writes: 4, bytes: 8000 });
	});
	it('falls back to folder names for missing and bad manifests', async () => {
		for (const manifest of [undefined, '{', '{"name":7}', '{"name":""}']) {
			const f = fixture(); f.put(path, 0); if (manifest) f.manifests.set('.obsidian/plugins/test/manifest.json', manifest);
			await f.watch.start(); expect(f.watch.session!.rows[0]!.name).toBe('test');
		}
	});
	it('excludes its own data on both paths', async () => {
		const f = fixture(); const own = '.obsidian/plugins/sync-churn-watch/data.json'; f.put(own, 0); await f.watch.start(); f.put(own, 2); await f.watch.poll(); f.watch.observe(own, 'own', 'vault', 10);
		expect(f.watch.session!.rows).toEqual([]); expect(f.adapter.stat.mock.calls.flat()).not.toContain(own);
	});
	it('shows existing core files with no community plugins', async () => {
		const f = fixture(); f.put('.obsidian/app.json', 1); f.adapter.list.mockRejectedValue(new Error('Missing folder')); await f.watch.start();
		expect(f.watch.session!.rows[0]!.path).toBe('.obsidian/app.json');
	});
	it('stops reads and freezes the rate after stop', async () => {
		const f = fixture(); await f.watch.start(); f.watch.observe('A.md', 'A.md', 'vault', 2000); f.time(60_000); f.watch.stop();
		const calls = f.adapter.stat.mock.calls.length; await f.watch.poll(); f.watch.observe('A.md', 'A.md', 'vault', 9);
		expect(f.adapter.stat).toHaveBeenCalledTimes(calls); expect(rate(f.watch.session!.rows[0]!, f.watch.session!, 3_600_000)).toBe(60);
	});
	it('drops a stat response after stop and starts a fresh session', async () => {
		const f = fixture(); f.put(path, 0); await f.watch.start();
		let release!: (value: null) => void;
		f.adapter.stat.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
		const pending = f.watch.poll(); await Promise.resolve(); await Promise.resolve();
		f.watch.stop(); release(null); await pending;
		expect(f.watch.session!.rows[0]!.writes).toBe(0); await f.watch.start(); expect(f.watch.session!.rows[0]!.writes).toBe(0);
	});
	it('does not issue overlapping scans', async () => {
		const f = fixture(); await f.watch.start(); const before = f.adapter.list.mock.calls.length;
		await Promise.all([f.watch.poll(), f.watch.poll(), f.watch.poll()]); expect(f.adapter.list).toHaveBeenCalledTimes(before + 1);
	});
	it('continues after a stat failure and reports unreadable files', async () => {
		const f = fixture(); f.put(path, 0); f.adapter.stat.mockRejectedValueOnce(new Error('Permission')); await f.watch.start();
		expect(f.watch.unreadable).toBe(1); expect(f.watch.session!.rows[0]!.name).toBe('test');
	});
	it('uses a custom config folder and detects creation after baseline', async () => {
		const f = fixture('config'); await f.watch.start(); f.put('config/app.json', 1); await f.watch.poll();
		expect(f.watch.session!.rows[0]).toMatchObject({ path: 'config/app.json', writes: 1 });
	});
	it('counts an mtime decrease, then a recreated file', async () => {
		const f = fixture(); f.put(path, 5); await f.watch.start(); f.put(path, 1); await f.watch.poll(); f.files.delete(path); await f.watch.poll(); f.put(path, 6); await f.watch.poll();
		// A removed plugin folder is not scanned. A restored mtime still differs from its last observation.
		expect(f.watch.session!.rows[0]!.writes).toBe(2);
	});
	it('stops without reading on dispose', async () => {
		const f = fixture(); await f.watch.start(); const calls = f.adapter.stat.mock.calls.length; f.watch.dispose(); await f.watch.poll();
		expect(f.watch.active).toBe(false); expect(f.adapter.stat).toHaveBeenCalledTimes(calls);
	});
	it('copies a sorted table with escaped paths and estimated bytes', async () => {
		const f = fixture(); await f.watch.start(); f.watch.observe('b|c.md', 'b', 'vault', 40); f.watch.observe('A.md', 'A', 'vault', 2000); f.watch.observe('A.md', 'A', 'vault', 1000); f.time(3_600_000); f.watch.stop();
		const text = markdown(f.watch.session, 3_600_000); expect(text).toContain('| File | Writes | Writes/h | Est. bytes |');
		expect(text.indexOf('| A.md')).toBeLessThan(text.indexOf('| b\\|c.md')); expect(text).toContain('| A.md | 2 | 2 | 3000 |');
	});
	it('suggests unique parent folders from the top five files', async () => {
		const f = fixture(); await f.watch.start();
		for (const path of ['A.md', 'Notes/a.md', 'Notes/b.md', '.obsidian/plugins/test/data.json', 'assets/a.png', 'other/z.md']) f.watch.observe(path, path, 'vault', 5);
		expect(exclusionFolders(f.watch.session)).toEqual(['.obsidian/plugins/test', 'assets', 'Notes']);
	});
	it('groups actual observations by local day across midnight', async () => {
		const f = fixture(); f.time(new Date(2026, 9, 11, 23, 59).getTime()); await f.watch.start(); f.watch.observe('A.md', 'A.md', 'vault', 1);
		f.time(new Date(2026, 9, 12, 0, 1).getTime()); f.watch.observe('A.md', 'A.md', 'vault', 1); f.watch.stop();
		expect(dailyHistory([f.watch.session!])).toEqual([['2026-10-11', 1], ['2026-10-12', 1]]);
	});
});

describe('stop while a new start waits for an old scan', () => {
	it('keeps the stopped session and returns nothing to save', async () => {
		const f = fixture(); f.put(path, 0); await f.watch.start();
		let release!: (value: null) => void;
		f.adapter.stat.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
		const pending = f.watch.poll(); await Promise.resolve(); await Promise.resolve();
		f.time(60_000); const first = f.watch.stop()!; expect(first.stopped).toBe(60_000);
		const restart = f.watch.start(); f.time(120_000);
		expect(f.watch.stop()).toBeNull(); expect(first.stopped).toBe(60_000);
		release(null); await pending; await restart;
		expect(f.watch.active).toBe(false); expect(f.watch.starting).toBe(false); expect(f.watch.session).toBe(first);
	});
});
