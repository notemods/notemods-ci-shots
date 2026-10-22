import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId, reloadPlugin } from './load';

// 300 ms is the product budget (FX_PERF_STRICT=1). The default ceiling tolerates a busy machine and only catches
// algorithmic regressions.
const PERF_BUDGET_MS = process.env.FX_PERF_STRICT === '1' ? 300 : 1500;

// Real-app checks of the Flatten Table Bases view on the sample vault (12 project notes, 43 milestones in a list
// property, 11 of them done, 4 owners). The same numbers are pinned in tests/sample.test.ts.
const DIR = 'Flatten Table';
const NOTE = `${DIR}/Projects/Billing migration.md`;

interface ViewState {
	rows: number;
	domRows: number;
	sources: number;
	skipped: number;
	headers: string[];
	groups: number;
	firstHours: string;
	limitText: string;
	stats: { notes: number; rows: number; totalMs: number } | null;
}

/** State of the visible flat table view (the newest one when there are several). */
async function viewState(): Promise<ViewState | null> {
	return browser.executeObsidian(({ app }, id) => {
		interface V {
			last: { rows: unknown[]; sources: number; skippedSources: number } | null;
			stats: ViewState['stats'];
			containerEl: HTMLElement;
		}
		const p = (app as unknown as { plugins: { plugins: Record<string, { views: Set<V> }> } }).plugins.plugins[id];
		const views = [...(p?.views ?? [])].filter((v) => v.containerEl.isConnected && v.containerEl.offsetParent !== null && v.last);
		const v = views[views.length - 1];
		if (!v || !v.last) return null;
		const el = v.containerEl;
		const headers = Array.from(el.querySelectorAll('thead th')).map((th) => th.textContent?.trim() ?? '');
		const k = headers.indexOf('hours');
		const first = el.querySelector('tbody tr:not(.flatten-table-group)');
		return {
			rows: v.last.rows.length,
			domRows: el.querySelectorAll('tbody tr:not(.flatten-table-group)').length,
			sources: v.last.sources,
			skipped: v.last.skippedSources,
			headers,
			groups: el.querySelectorAll('tbody tr.flatten-table-group').length,
			firstHours: k >= 0 ? (first?.children[k]?.textContent ?? '') : '',
			limitText: el.querySelector('.flatten-table-limit')?.textContent ?? '',
			stats: v.stats,
		};
	}, pluginId);
}

async function waitFor(pred: (s: ViewState) => boolean, msg: string, timeout = 20000): Promise<ViewState> {
	let last: ViewState | null = null;
	await browser.waitUntil(
		async () => {
			last = await viewState();
			return last !== null && pred(last);
		},
		{ timeout, interval: 250, timeoutMsg: `${msg}; last state ${JSON.stringify(last)}` },
	);
	return last!;
}

/** Pro on: a stubbed GitHub Sponsors reply ($5 a month) and a fake token, then Refresh. Pro off: sign out. No real request. */
async function setPro(on: boolean): Promise<void> {
	await browser.executeObsidian(
		async ({ app }, id, value) => {
			interface Pro {
				opts: { http: unknown };
				refreshNow(): Promise<void>;
				signOut(): void;
			}
			const p = (app as unknown as { plugins: { plugins: Record<string, { pro: Pro }> } }).plugins.plugins[id]!;
			if (!value) {
				p.pro.signOut();
				return;
			}
			const reply = { status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } };
			p.pro.opts.http = () => Promise.resolve(reply);
			app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
			await p.pro.refreshNow();
		},
		pluginId,
		on,
	);
}

/** Clicks the header cell of a column in the visible flat table. */
async function clickHeader(name: string): Promise<void> {
	await browser.execute((n: string) => {
		const ths = Array.from(document.querySelectorAll<HTMLElement>('.workspace-leaf.mod-active .flatten-table th'));
		ths.find((th) => th.offsetParent !== null && th.textContent?.trim() === n)?.click();
	}, name);
}

/** Opens a note that embeds one view of the sample base, so each test sees exactly one flat table view. */
async function openEmbed(view: string): Promise<void> {
	const path = `${DIR}/E2E ${view}.md`;
	await obsidianPage.write(path, `![[${DIR}/Projects.base#${view}]]\n`);
	await obsidianPage.openFile(path);
}

/** Adds a milestone to the sample note through the front matter API, or puts the old text back. */
async function addMilestone(step: string): Promise<string> {
	return browser.executeObsidian(async ({ app }, path, name) => {
		const file = app.vault.getFileByPath(path)!;
		const before = await app.vault.read(file);
		await app.fileManager.processFrontMatter(file, (fm: { milestones: unknown[] }) => {
			fm.milestones.push({ step: name, owner: 'Ana', due: '2026-12-01', status: 'todo', hours: 2 });
		});
		return before;
	}, NOTE, step);
}

describe(`${pluginId} in the real app`, function () {
	before(async function () {
		await setPro(false);
	});

	it('is enabled and reloads with no console errors', async function () {
		const state = await reloadPlugin(pluginId);
		expect(state).toEqual({ enabled: true, reloaded: true, errors: [] });
	});

	it('Bases is on and the view type is registered', async function () {
		const ok = await browser.executeObsidian(({ app }) => {
			const bases = (app as unknown as { internalPlugins: { getEnabledPluginById(id: string): unknown } }).internalPlugins.getEnabledPluginById('bases');
			return bases !== null;
		});
		expect(ok).toBe(true);
	});

	it('flattens 43 milestones from 11 notes into rows with the item keys as columns', async function () {
		await obsidianPage.openFile(`${DIR}/Projects.base`);
		const s = await waitFor((x) => x.rows === 43, 'expected 43 rows');
		expect(s.domRows).toBe(43);
		expect(s.sources).toBe(11);
		expect(s.headers).toEqual(['Source', 'step', 'owner', 'due', 'status', 'hours']);
	});

	it('sorts by a column when the header is clicked', async function () {
		await obsidianPage.openFile(`${DIR}/Projects.base`);
		const start = await waitFor((x) => x.rows === 43, 'table not drawn');
		await clickHeader('hours');
		await waitFor((x) => x.firstHours === '1', 'ascending sort by hours');
		await clickHeader('hours');
		await waitFor((x) => x.firstHours === '9', 'descending sort by hours');
		await clickHeader('hours');
		await waitFor((x) => x.firstHours === start.firstHours, 'back to base order');
	});

	it('sorts by owner then due date for free and keeps rules after a reload', async function () {
		// Use a separate base so earlier tabs cannot save an old sort over this test's sort.
		const basePath = `${DIR}/Multi-sort.base`;
		const content = await browser.executeObsidian(async ({ app }, path) => app.vault.read(app.vault.getFileByPath(path)!), `${DIR}/Projects.base`);
		await obsidianPage.write(basePath, content);
		await obsidianPage.openFile(basePath);
		await waitFor((x) => x.rows === 43, 'table not drawn');
		const check = async (click: boolean) => browser.executeObsidian(async ({ app }, id, apply) => {
			interface V {
				config: { get(key: string): unknown; set(key: string, value: unknown): void };
				render(): void;
				last: { rows: { cells: string[] }[] };
				containerEl: HTMLElement;
			}
			const p = (app as unknown as { plugins: { plugins: Record<string, { views: Set<V> }> } }).plugins.plugins[id]!;
			const v = [...p.views].find((view) => view.containerEl.isConnected && view.containerEl.offsetParent !== null)!;
			if (apply) {
				v.config.set('flattenSort', null);
				v.render();
				const header = (name: string) => [...v.containerEl.querySelectorAll<HTMLElement>('th')].find((th) => th.querySelector('button > span')?.textContent === name)!;
				header('owner').click();
				await new Promise((r) => setTimeout(r, 300));
				header('due').dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
				await new Promise((r) => setTimeout(r, 500));
			}
			return {
				rules: v.config.get('flattenSort'),
				values: v.last.rows.map((row) => [row.cells[1]!, row.cells[2]!]),
				priorities: [...v.containerEl.querySelectorAll('.flatten-table-sort-priority')].map((el) => el.textContent),
			};
		}, pluginId, click);
		const sorted = await check(true);
		expect(sorted.rules).toEqual([{ column: 'owner', dir: 'asc' }, { column: 'due', dir: 'asc' }]);
		expect(sorted.priorities).toEqual(['1', '2']);
		for (let i = 1; i < sorted.values.length; i++) {
			const before = sorted.values[i - 1]!;
			const after = sorted.values[i]!;
			expect(before[0]! < after[0]! || (before[0] === after[0] && before[1]! <= after[1]!)).toBe(true);
		}
		// Bases saves view changes after a delay. Check the file before the reload reads it again.
		await browser.waitUntil(async () => browser.executeObsidian(async ({ app }, path) => {
			const text = await app.vault.read(app.vault.getFileByPath(path)!);
			return text.includes('- column: owner') && text.includes('- column: due');
		}, basePath), { timeout: 10000, interval: 250, timeoutMsg: 'sort rules did not reach the base file' });
		expect((await reloadPlugin(pluginId)).errors).toEqual([]);
		await waitFor((x) => x.rows === 43, 'table not drawn after reload');
		expect(await check(false)).toEqual(sorted);
		await browser.executeObsidian(({ app }, id) => {
			interface V { config: { set(key: string, value: unknown): void }; render(): void; containerEl: HTMLElement }
			const p = (app as unknown as { plugins: { plugins: Record<string, { views: Set<V> }> } }).plugins.plugins[id]!;
			for (const v of p.views) if (v.containerEl.offsetParent !== null) { v.config.set('flattenSort', null); v.render(); }
		}, pluginId);
	});

	it('redraws when a list property changes', async function () {
		await obsidianPage.openFile(`${DIR}/Projects.base`);
		await waitFor((x) => x.rows === 43, 'table not drawn');
		const before = await addMilestone('Live update');
		await waitFor((x) => x.rows === 44, 'the new row did not appear');
		await obsidianPage.write(NOTE, before);
		await waitFor((x) => x.rows === 43, 'the row did not go away');
	});

	it('after a plugin reload with the base open, the view runs the new plugin code and follows edits', async function () {
		await obsidianPage.openFile(`${DIR}/Projects.base`);
		await waitFor((x) => x.rows === 43, 'table not drawn');
		expect((await reloadPlugin(pluginId)).errors).toEqual([]);
		// viewState() only sees views of the loaded plugin, so a stale view of the old code times out here.
		await waitFor((x) => x.rows === 43, 'no flat table view in the reloaded plugin');
		const command = await browser.executeObsidian(({ app }, id) => {
			const commands = (app as unknown as { commands: { findCommand(id: string): { checkCallback?(checking: boolean): boolean } | undefined } }).commands;
			return commands.findCommand(`${id}:export-csv`)?.checkCallback?.(true) ?? false;
		}, pluginId);
		expect(command).toBe(true);
		const before = await addMilestone('After reload');
		await waitFor((x) => x.rows === 44, 'the new row did not appear after the reload');
		await obsidianPage.write(NOTE, before);
		await waitFor((x) => x.rows === 43, 'the row did not go away after the reload');
	});

	it('free version: no groups, no filter and no export buttons', async function () {
		await openEmbed('By owner');
		const s = await waitFor((x) => x.rows === 43, 'embedded view not drawn');
		expect(s.groups).toBe(0);
		await openEmbed('Open milestones');
		await waitFor((x) => x.rows === 43, 'the filter must be off in the free version');
		expect(await (await browser.$$('.workspace-leaf.mod-active .flatten-table-export')).length).toBe(0);
	});

	it('Pro: group by owner, filter open milestones, CSV export', async function () {
		await setPro(true);
		await openEmbed('By owner');
		await waitFor((x) => x.groups === 4, 'expected 4 owner groups');
		await openEmbed('Open milestones');
		const o = await waitFor((x) => x.rows === 32, 'expected 32 open milestones');
		expect(o.headers).toContain('due');
		const csv = await browser.executeObsidian(async ({ app }, id) => {
			interface P {
				targetView(): unknown;
				exportView(v: unknown, kind: 'csv'): Promise<{ path: string } | null>;
			}
			const p = (app as unknown as { plugins: { plugins: Record<string, P> } }).plugins.plugins[id]!;
			const f = await p.exportView(p.targetView(), 'csv');
			const file = f ? app.vault.getFileByPath(f.path) : null;
			const text = file ? await app.vault.read(file) : '';
			if (file) await app.vault.delete(file);
			return text;
		}, pluginId);
		expect(csv.split('\r\n').filter(Boolean)).toHaveLength(33);
		expect(csv.startsWith('Source,step,owner,due,status,hours')).toBe(true);
		await setPro(false);
	});

	it('500 notes: free limit of 50, Pro renders all 2,500 rows inside the budget', async function () {
		await browser.executeObsidian(async ({ app }) => {
			await app.vault.createFolder('Perf').catch(() => undefined);
			const items = Array.from({ length: 5 }, (_, k) => `  - item: Item ${k}\n    amount: ${k + 1}\n    status: ${k % 2 ? 'done' : 'open'}`).join('\n');
			const jobs: Promise<unknown>[] = [];
			for (let i = 0; i < 500; i++) {
				const path = `Perf/Note ${String(i).padStart(3, '0')}.md`;
				if (!app.vault.getFileByPath(path)) jobs.push(app.vault.create(path, `---\ntags: [perf]\nlog:\n${items}\n---\nBody\n`));
			}
			await Promise.all(jobs);
			await app.vault.create('Perf/Perf.base', 'filters:\n  and:\n    - file.hasTag("perf")\nviews:\n  - type: flatten-table\n    name: Perf\n    property: note.log\n').catch(() => undefined);
		});
		await obsidianPage.openFile('Perf/Perf.base');
		const free = await waitFor((x) => x.sources === 50 && x.skipped === 450, 'free limit of 50 notes', 60000);
		expect(free.rows).toBe(250);
		expect(free.limitText).toContain('450 more notes');
		await setPro(true);
		const pro = await waitFor((x) => x.sources === 500, 'Pro reads all 500 notes', 60000);
		expect(pro.rows).toBe(2500);
		const warm = await browser.executeObsidian(({ app }, id) => {
			interface V {
				render(): void;
				stats: { totalMs: number } | null;
				containerEl: HTMLElement;
			}
			const p = (app as unknown as { plugins: { plugins: Record<string, { views: Set<V> }> } }).plugins.plugins[id]!;
			const v = [...p.views].find((x) => x.containerEl.isConnected && x.containerEl.offsetParent !== null)!;
			const out: number[] = [];
			for (let i = 0; i < 5; i++) {
				v.render();
				out.push(Math.round(v.stats?.totalMs ?? -1));
			}
			return out;
		}, pluginId);
		console.log(`perf: 500 notes, 2500 rows; first render ${Math.round(pro.stats?.totalMs ?? -1)} ms; 5 re-renders ${warm.join(', ')} ms`);
		expect(pro.stats?.totalMs ?? 9999).toBeLessThan(PERF_BUDGET_MS);
		for (const ms of warm) expect(ms).toBeLessThan(PERF_BUDGET_MS);
		await setPro(false);
	});
});
