import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { captureErrors, openWithPane, pane, takeErrors, waitPane } from './pane';

const N = 10_000;
const BATCH = 500;

describe('A vault with 10,000 notes', function () {
	it('E6 E9 debounces the bulk events, updates after one change, and keeps the scroll position', async function () {
		this.timeout(900_000);
		await obsidianPage.resetVault();
		await captureErrors();
		await takeErrors();
		await openWithPane('Tech features.md');
		const before = (await pane())!;
		const t0 = Date.now();
		// Note i links to two other bulk notes. Every 10th note also links to Tech features: 1,000 one-way backlinks.
		await browser.executeObsidian(async ({ app }) => {
			if (!app.vault.getFolderByPath('Bulk')) await app.vault.createFolder('Bulk');
		});
		for (let start = 0; start < N; start += BATCH) {
			await browser.executeObsidian(async ({ app }, from, size, n) => {
				const jobs: Promise<unknown>[] = [];
				for (let i = from; i < Math.min(from + size, n); i++) {
					const body = `[[B${(i + 1) % n}]] [[B${(i + 7) % n}]]${i % 10 === 0 ? ' [[Tech features]]' : ''}\n`;
					jobs.push(app.vault.create(`Bulk/B${i}.md`, body));
				}
				await Promise.all(jobs);
			}, start, BATCH, N);
		}
		const created = Date.now() - t0;
		const bulk = await waitPane((p) => p.oneWay === 1003, '1,003 one-way rows after the bulk create', 300_000);
		const settled = Date.now() - t0;
		const computes = bulk.computes - before.computes;
		const draws = bulk.draws - before.draws;
		console.info(`10,000 notes: create ${created} ms, pane settled ${settled} ms, ${computes} computes, ${draws} draws, last compute ${bulk.lastComputeMs.toFixed(1)} ms`);
		// About 10,000 resolve events came. The debounce turns them into few updates.
		expect(computes).toBeLessThan(500);
		expect(bulk.rows.length).toBe(1003);

		// One change in a large vault: the time from the write to the new row.
		await browser.executeObsidian(({ app }) => {
			const el = app.workspace.getLeavesOfType('one-way-backlinks')[0]!.view.containerEl.querySelector('.view-content') as HTMLElement;
			el.scrollTop = 600;
		});
		const t1 = Date.now();
		await browser.executeObsidian(async ({ app }) => {
			await app.vault.process(app.vault.getFileByPath('Bulk/B5.md')!, (t) => t + 'Now [[Tech features]].\n');
		});
		const after = await waitPane((p) => p.oneWay === 1004, 'one more row after one change', 30_000);
		console.info(`one change in 10,000 notes: pane update ${Date.now() - t1} ms (debounce 250 ms), compute ${after.lastComputeMs.toFixed(1)} ms`);
		expect(after.lastComputeMs).toBeLessThan(2000);
		// E9: the update keeps the scroll position of the list.
		expect(after.scrollTop).toBe(600);
		expect(await takeErrors()).toEqual([]);
	});
});
