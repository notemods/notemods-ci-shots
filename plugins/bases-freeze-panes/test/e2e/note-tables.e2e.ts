import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId } from './load';

async function setNoteTables(on: boolean): Promise<void> {
	await browser.executeObsidian(({ app }, id, enabled) => {
		const plugin = (app as unknown as { plugins: { plugins: Record<string, { settings: { freezeNoteTables: boolean }; refresh(): void }> } }).plugins.plugins[id]!;
		plugin.settings.freezeNoteTables = enabled;
		plugin.refresh();
	}, pluginId, on);
}

async function scrollNoteTable(): Promise<{ before: number[]; after: number[]; scroll: number[] }> {
	return browser.executeAsync((done: (result: { before: number[]; after: number[]; scroll: number[] }) => void) => {
		const box = Array.from(document.querySelectorAll<HTMLElement>('.workspace-leaf.mod-active .bfp-note-table')).find((el) => el.offsetParent !== null)!;
		const head = box.querySelector('thead th')!;
		const cell = box.querySelector('tbody td')!;
		box.scrollLeft = 0;
		box.scrollTop = 0;
		const first = head.getBoundingClientRect();
		const cellLeft = Math.round(cell.getBoundingClientRect().left);
		box.scrollLeft = 300;
		box.scrollTop = 240;
		setTimeout(() => {
			const last = head.getBoundingClientRect();
			done({ before: [Math.round(first.left), Math.round(first.top), cellLeft], after: [Math.round(last.left), Math.round(last.top), Math.round(cell.getBoundingClientRect().left)], scroll: [box.scrollLeft, box.scrollTop] });
		}, 500);
	});
}

describe(`${pluginId} rendered note tables`, function () {
	after(async function () {
		await setNoteTables(false);
	});

	for (const mode of ['preview', 'source'] as const) {
		it(`keeps the header and first column in view in ${mode} mode`, async function () {
			await obsidianPage.openFile('Bases Freeze Panes/Project review.md');
			await browser.executeObsidian(async ({ app }, viewMode) => {
				await app.workspace.getLeaf(false).setViewState({ type: 'markdown', state: { file: app.workspace.getActiveFile()?.path, mode: viewMode } });
			}, mode);
			await setNoteTables(true);
			await browser.waitUntil(async () => await browser.execute(() => Array.from(document.querySelectorAll<HTMLElement>('.workspace-leaf.mod-active .bfp-note-table')).some((el) => el.offsetParent !== null)), { timeout: 15000 });
			const result = await scrollNoteTable();
			expect(result.scroll[0]).toBeGreaterThan(100);
			expect(result.scroll[1]).toBeGreaterThan(200);
			expect(result.after).toEqual(result.before);
		});
	}

	it('restores the original table when the setting is off', async function () {
		await setNoteTables(false);
		expect(await browser.execute(() => document.querySelectorAll('.bfp-note-table').length)).toBe(0);
		expect(await browser.execute(() => document.querySelectorAll('.workspace-leaf.mod-active table').length)).toBeGreaterThan(0);
	});
});
