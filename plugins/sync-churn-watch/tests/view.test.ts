import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import SyncChurnWatchPlugin from '../src/main';
import { ChurnView, VIEW_ID } from '../src/view';
import { bindPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';

afterEach(() => { resetPro(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('watch view redraws', () => {
	it('redraws a bulk edit of many notes a few times, not once per event', async () => {
		vi.useFakeTimers();
		const app = App.createConfigured__({ files: { 'A.md': 'hello' } });
		const p = new SyncChurnWatchPlugin(app as never, manifest as never);
		await p.onload();
		try {
			await p.startSession();
			const view = new ChurnView(app.workspace.getLeaf(false) as never, p);
			vi.spyOn(app.workspace, 'getLeavesOfType').mockImplementation((type: string) => type === VIEW_ID ? [{ view }] as never : []);
			const render = vi.spyOn(view, 'render');
			for (let n = 0; n < 2000; n++) p.watch.observe(`Notes/${n}.md`, `${n}.md`, 'vault', 100);
			await vi.advanceTimersByTimeAsync(2000);
			expect(render.mock.calls.length).toBeGreaterThanOrEqual(1);
			expect(render.mock.calls.length).toBeLessThanOrEqual(5);
		} finally { p.onunload(); }
	});
	it('keeps the scroll position and open history after a poll redraw', async () => {
		const app = App.createConfigured__({ files: { 'A.md': 'hello' } });
		const p = new SyncChurnWatchPlugin(app as never, manifest as never);
		bindPro({ isPro: () => true, onChange: () => () => {} } as never);
		p.watch = { active: true, session: { started: 0, stopped: null, rows: [], days: {} }, unreadable: 0 } as never;
		p.history = [{ started: 1000, stopped: 2000, rows: [{ path: 'A.md', name: 'A.md', group: 'vault', writes: 2, bytes: 4 }], days: { '2026-10-12': 2 } }];
		const view = new ChurnView(app.workspace.getLeaf(false) as never, p);
		view.render();
		const opened = view.contentEl.querySelectorAll('details');
		expect(opened).toHaveLength(2);
		for (const d of Array.from(opened)) d.open = true;
		view.contentEl.scrollTop = 400;
		view.render();
		const after = Array.from(view.contentEl.querySelectorAll('details'));
		expect(after.map((d) => d.open)).toEqual([true, true]);
		expect(view.contentEl.scrollTop).toBe(400);
	});
});
