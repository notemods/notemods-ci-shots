import { browser, expect } from '@wdio/globals';
import { pluginId, reloadPlugin } from './load';
import type SyncChurnWatchPlugin from '../../src/main';

describe('Sync Churn Watch in Obsidian', function () {
	it('loads and reloads without console errors', async () => {
		expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] });
	});
	it('opens the free view with No session', async () => {
		await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, SyncChurnWatchPlugin> } }).plugins.plugins['sync-churn-watch']!;
			await p.stopSession(); p.watch.session = null; await p.openView(); p.redraw();
		});
		// The first reveal of the right sidebar can still be laid out when the call returns (seen on 1.14.4).
		const state = browser.$('.sync-churn-state');
		await state.waitForDisplayed({ timeout: 5000 });
		expect(await state.getText()).toBe('No session');
	});
	it('counts three settings writes and labels the lower bound', async () => {
		const state = await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, SyncChurnWatchPlugin> } }).plugins.plugins['sync-churn-watch']!;
			await p.stopSession();
			const dir = `${app.vault.configDir}/plugins/watch-test`;
			if (!await app.vault.adapter.exists(dir)) await app.vault.adapter.mkdir(dir);
			await app.vault.adapter.write(`${dir}/manifest.json`, '{"name":"Test writer"}');
			const base = Date.now();
			await app.vault.adapter.write(`${dir}/data.json`, '{"n":0}', { mtime: base });
			await p.startSession();
			for (let n = 1; n <= 3; n++) {
				await app.vault.adapter.write(`${dir}/data.json`, JSON.stringify({ n }), { mtime: base + n * 15_000 });
				await p.watch.poll();
			}
			await p.openView(); p.redraw();
			return { row: p.watch.session!.rows.find((r) => r.path === `${dir}/data.json`), own: p.watch.session!.rows.some((r) => r.path === `${app.vault.configDir}/plugins/sync-churn-watch/data.json`) };
		});
		expect(state.row).toMatchObject({ name: 'Test writer', writes: 3, group: 'settings' });
		expect(state.own).toBe(false);
		expect(await browser.$('.sync-churn-table thead').getText()).toContain('Writes (at least)');
	});
	it('counts a burst once and uses a folder name without a manifest', async () => {
		const rows = await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, SyncChurnWatchPlugin> } }).plugins.plugins['sync-churn-watch']!;
			await p.stopSession(); const dir = `${app.vault.configDir}/plugins/no-manifest`;
			if (!await app.vault.adapter.exists(dir)) await app.vault.adapter.mkdir(dir);
			const base = Date.now(); await app.vault.adapter.write(`${dir}/data.json`, '{}', { mtime: base });
			await p.startSession();
			await app.vault.adapter.write(`${dir}/data.json`, '{"n":1}', { mtime: base + 1 });
			await app.vault.adapter.write(`${dir}/data.json`, '{"n":2}', { mtime: base + 2 }); await p.watch.poll();
			return p.watch.session!.rows;
		});
		expect(rows.find((r) => r.name === 'no-manifest')).toMatchObject({ writes: 1 });
	});
	it('counts four note events with 8000 estimated bytes', async () => {
		const row = await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, SyncChurnWatchPlugin> } }).plugins.plugins['sync-churn-watch']!;
			await p.stopSession();
			const file = app.vault.getFileByPath('A.md') ?? await app.vault.create('A.md', '0'.repeat(2000)); await p.startSession();
			for (let n = 1; n <= 4; n++) {
				const observed = new Promise<void>((resolve) => {
					const ref = app.vault.on('modify', (changed) => { if (changed.path === 'A.md') { app.vault.offref(ref); resolve(); } });
				});
				await app.vault.process(file, () => String(n).repeat(2000)); await observed;
			}
			return p.watch.session!.rows.find((r) => r.path === 'A.md');
		});
		expect(row).toMatchObject({ group: 'vault', writes: 4, bytes: 8000 });
	});
	it('stops polling and saves only once', async () => {
		const state = await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, SyncChurnWatchPlugin> } }).plugins.plugins['sync-churn-watch']!;
			const save = p.saveData.bind(p); const stat = app.vault.adapter.stat.bind(app.vault.adapter); let saves = 0; let stats = 0;
			p.saveData = async (data: unknown) => { saves++; await save(data); };
			app.vault.adapter.stat = async (path) => { stats++; return stat(path); };
			try {
				const before = JSON.stringify(p.watch.session!.rows); await Promise.all([p.stopSession(), p.stopSession()]); await p.stopSession(); stats = 0; await p.watch.poll();
				return { saves, stats, active: p.watch.active, unchanged: before === JSON.stringify(p.watch.session!.rows), timer: (p as unknown as { timer: number | null }).timer };
			} finally { p.saveData = save; app.vault.adapter.stat = stat; }
		});
		expect(state).toEqual({ saves: 1, stats: 0, active: false, unchanged: true, timer: null });
	});
	it('copies the free Markdown table through its command', async () => {
		await browser.executeObsidianCommand(`${pluginId}:copy-results`);
		// Await the command completion through the clipboard content, not a fixed delay.
		await browser.waitUntil(async () => (await browser.executeAsync((done) => { navigator.clipboard.readText().then(done); }) as string).includes('| A.md | 4 |'), { timeout: 5000 });
		const text = await browser.executeAsync((done) => { navigator.clipboard.readText().then(done); });
		expect(text).toContain('| File | Writes | Writes/h | Est. bytes |');
	});
	it('guards folder copy in the free state', async () => {
		const text = await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, SyncChurnWatchPlugin> } }).plugins.plugins['sync-churn-watch']!;
			p.pro!.signOut(); await navigator.clipboard.writeText('free marker'); await p.copyExclusions(); return navigator.clipboard.readText();
		});
		expect(text).toBe('free marker');
	});
	it('shows Pro history and one rate notice after a mocked sponsor check', async () => {
		const state = await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, SyncChurnWatchPlugin> } }).plugins.plugins['sync-churn-watch']!;
			const pro = p.pro!; const opts = (pro as unknown as { opts: { http: (...args: unknown[]) => Promise<unknown> } }).opts; const originalHttp = opts.http;
			opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
			app.secretStorage.setSecret('sync-churn-watch-github-token', 'gho_' + '0'.repeat(36));
			try {
				await pro.refreshNow(); await p.stopSession(); p.history = []; p.settings.alerts = true; p.settings.threshold = 1;
				document.querySelectorAll('.notice').forEach((n) => n.remove()); await p.startSession();
				p.watch.observe('Notes/Pro sample.md', 'Pro sample', 'vault', 20); p.watch.observe('Notes/Pro sample.md', 'Pro sample', 'vault', 20);
				const notices = [...document.querySelectorAll('.notice')].filter((n) => n.textContent?.includes('Pro sample:')).length;
				await p.stopSession(); await p.openView(); p.redraw(); await p.copyExclusions();
				return { notices, count: p.history.length, days: document.querySelectorAll('.sync-churn-day').length, folders: await navigator.clipboard.readText() };
			} finally { pro.signOut(); opts.http = originalHttp; p.settings.alerts = false; }
		});
		expect(state).toEqual({ notices: 1, count: 1, days: 1, folders: 'Notes' });
	});
	it('unloads an active session without console errors', async () => {
		await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, SyncChurnWatchPlugin> } }).plugins.plugins['sync-churn-watch']!; await p.startSession();
		});
		expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] });
		const active = await browser.executeObsidian(({ app }) => (app as unknown as { plugins: { plugins: Record<string, SyncChurnWatchPlugin> } }).plugins.plugins['sync-churn-watch']!.watch.active);
		expect(active).toBe(false);
	});
});
