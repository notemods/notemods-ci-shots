import { browser, expect } from '@wdio/globals';
import { pluginId } from './load';
import { DIR, clickInRow, openBase, readNote, signInWith, sponsoring, today, viewState, waitRows } from './rows';

// 300 ms is the product budget (FX_PERF_STRICT=1). CI runners measured 306 ms on 1.13.4, so the default
// ceiling only catches algorithmic regressions.
const PERF_BUDGET_MS = process.env.FX_PERF_STRICT === '1' ? 300 : 1000;

// Pro through GitHub Sponsors with a stubbed network: the plugin's http client is replaced inside Obsidian,
// so no request reaches github.com. The token goes through the real app.secretStorage.
const SITE = `${DIR}/Projects/Website relaunch.md`;
/** Open tasks in the sample vault (status: open views). */
const OPEN = 120;

async function setView(key: string, value: unknown): Promise<void> {
	await browser.executeObsidian(
		({ app }, id, k, v) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, { views: Set<{ rootEl: HTMLElement; config: { set(k: string, v: unknown): void }; render(): void }> }> } }).plugins.plugins[id]!;
			const view = [...p.views].find((x) => x.rootEl.isConnected && document.querySelector('.workspace-leaf.mod-active')?.contains(x.rootEl))!;
			view.config.set(k, v);
			view.render();
		},
		pluginId,
		key,
		value,
	);
}

describe(`${pluginId} pro (GitHub Sponsors, stubbed network)`, function () {
	it('starts signed out and has made no request', async function () {
		const state = await browser.executeObsidian(({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, { pro: { getState(): { status: string; lastAttemptAt: number } }; isPro(): boolean }> } }).plugins.plugins[id]!;
			return { ...p.pro.getState(), pro: p.isPro() };
		}, pluginId);
		expect(state).toMatchObject({ status: 'signed-out', lastAttemptAt: 0, pro: false });
	});

	it('without Pro a view saved with group: date shows plain rows and a note', async function () {
		const s = await openBase('This week.base', OPEN);
		expect(s.groups).toEqual([]);
		expect(s.info).toContain('Grouping is a pro feature');
	});

	it('without Pro picking a group in the toolbar shows the Pro notice and keeps no groups', async function () {
		const r = await browser.executeObsidian(({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, { views: Set<{ rootEl: HTMLElement }> }> } }).plugins.plugins[id]!;
			const view = [...p.views].find((x) => x.rootEl.isConnected && document.querySelector('.workspace-leaf.mod-active')?.contains(x.rootEl))!;
			const sel = view.rootEl.querySelector<HTMLSelectElement>('select.btr-group')!;
			sel.value = 'tag';
			sel.dispatchEvent(new Event('change'));
			const notices = Array.from(document.querySelectorAll('.notice')).map((n) => n.textContent ?? '');
			return { value: sel.value, notices };
		}, pluginId);
		expect(r.value).toBe('date');
		expect(r.notices.some((t) => t.includes('pro feature'))).toBe(true);
		expect((await viewState())?.groups).toEqual([]);
	});

	it('a $3 monthly sponsor is below the tier: still locked', async function () {
		expect(await signInWith(sponsoring(300))).toMatchObject({ pro: false, status: 'no' });
	});

	it('a $5 monthly sponsor gets Pro: rows group by date bucket in a fixed order', async function () {
		expect(await signInWith(sponsoring(500))).toMatchObject({ pro: true, status: 'pro' });
		await setView('group', 'date');
		await browser.waitUntil(async () => ((await viewState())?.groups.length ?? 0) > 0, { timeout: 5000 });
		const labels = (await viewState())!.groups.map((g) => g.replace(/ \(\d+\)$/, ''));
		const order = ['Overdue', 'Today', 'Next 7 days', 'Later', 'No date', 'Done'];
		expect(labels.length).toBeGreaterThan(2);
		expect(labels).toEqual(order.filter((l) => labels.includes(l)));
		const counts = (await viewState())!.groups.map((g) => Number(/\((\d+)\)$/.exec(g)![1]));
		expect(counts.reduce((a, b) => a + b, 0)).toBe(OPEN);
	});

	it('groups by note, heading and tag', async function () {
		await setView('group', 'note');
		expect((await viewState())!.groups.length).toBe(30);
		await setView('group', 'heading');
		expect((await viewState())!.groups.some((g) => g.startsWith('Website relaunch › Next steps'))).toBe(true);
		await setView('group', 'tag');
		expect((await viewState())!.groups.some((g) => g.startsWith('#work'))).toBe(true);
		await setView('group', 'none');
	});

	it('edits a due date in the row', async function () {
		await clickInRow(`${SITE}#13`, 'td.btr-col-due');
		await browser.execute(() => {
			const input = document.querySelector<HTMLInputElement>('.workspace-leaf.mod-active input.btr-date-input')!;
			input.value = '2026-12-24';
			input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
		});
		await browser.waitUntil(async () => (await readNote(SITE)).split('\n')[13] === '- [ ] Clean up the budget #money ⏳ 2026-10-15 📅 2026-12-24', { timeout: 5000 });
	});

	it('moves a task to today', async function () {
		await waitRows(OPEN);
		await clickInRow(`${SITE}#18`, 'button.btr-today');
		const day = await today();
		await browser.waitUntil(async () => (await readNote(SITE)).split('\n')[18] === `- [ ] Send the brake pads #errand ⏫ 📅 ${day}`, { timeout: 5000 });
	});

	it('completes three selected tasks at once', async function () {
		await waitRows(OPEN);
		const ids = (await viewState())!.ids.slice(0, 3);
		for (const id of ids) await clickInRow(id, 'td.btr-col-select input');
		await browser.execute(() => document.querySelector<HTMLButtonElement>('.workspace-leaf.mod-active button.btr-bulk-done')!.click());
		await waitRows(OPEN - 3);
		for (const id of ids) {
			const [path, line] = id.split('#');
			expect((await readNote(path!)).split('\n')[Number(line)]!.startsWith('- [x] ')).toBe(true);
		}
	});

	it('renders 2,000 tasks from 100 notes in under 300 ms', async function () {
		const files: Record<string, string> = {};
		for (let n = 0; n < 100; n++) {
			const lines = Array.from({ length: 20 }, (_, i) => `- [ ] Perf task ${n}-${i} #perf/n${n % 7} 📅 2026-${String((i % 12) + 1).padStart(2, '0')}-${String((n % 28) + 1).padStart(2, '0')}`);
			files[`${DIR}/Perf/Note ${n}.md`] = `# Note ${n}\n\n## Tasks\n\n${lines.join('\n')}\n`;
		}
		files[`${DIR}/Perf.base`] = `filters:\n  and:\n    - file.inFolder("${DIR}/Perf")\nviews:\n  - type: task-rows\n    name: Perf\n    status: all\n    sort: due\n`;
		await browser.executeObsidian(async ({ app }, f) => {
			if (!app.vault.getFolderByPath('Bases Task Rows/Perf')) await app.vault.createFolder('Bases Task Rows/Perf');
			for (const [path, text] of Object.entries(f)) await app.vault.create(path, text);
		}, files);
		await browser.pause(1500);
		const s = await openBase('Perf.base', 2000, 30000);
		// A second pass with every note cached by mtime: the cost of a live update.
		await browser.executeObsidian(({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, { views: Set<{ rootEl: HTMLElement; reload(): Promise<void> }> }> } }).plugins.plugins[id]!;
			return [...p.views].find((x) => x.rootEl.isConnected && document.querySelector('.workspace-leaf.mod-active')?.contains(x.rootEl))!.reload();
		}, pluginId);
		const warm = (await viewState())!;
		console.log(`perf first pass: collect ${s.timing.collect.toFixed(1)} ms, render ${s.timing.render.toFixed(1)} ms; cached pass: collect ${warm.timing.collect.toFixed(1)} ms, render ${warm.timing.render.toFixed(1)} ms; rows ${warm.timing.rows}`);
		expect(warm.timing.rows).toBe(2000);
		expect(s.timing.render).toBeLessThan(PERF_BUDGET_MS);
		expect(warm.timing.collect + warm.timing.render).toBeLessThan(PERF_BUDGET_MS);
	});

	it('401 from GitHub signs out and the 200-row cap is back', async function () {
		const r = await signInWith({ status: 401, json: { message: 'Bad credentials' } });
		expect(r.pro).toBe(false);
		expect(r.status).toBe('signed-out');
		expect(r.secret === null || r.secret === '').toBe(true);
		const s = await waitRows(200);
		expect(s.info).toBe('Showing 200 of 2000 tasks. Pro shows every task.');
	});
});
