import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId, reloadPlugin } from './load';

// Canary for the core Bases table DOM: scroll a wide table down and to the right, then check that the
// header cell and the first column cell are still at the same place on screen. These tests fail when
// Obsidian changes the table in a way the plugin no longer handles.
const DIR = 'Bases Freeze Panes';

interface Probe {
	header: [number, number] | null;
	cell: [number, number] | null;
	cellText: string | null;
	frozen: boolean;
	scroll: [number, number];
	firstCellInDom: boolean;
}

/** Scrolls the first visible table in the active tab to (left, top) and measures the frozen parts. */
async function probe(left: number, top: number): Promise<Probe | null> {
	return browser.executeAsync(
		(l: number, t: number, done: (p: Probe | null) => void) => {
			const views = Array.from(document.querySelectorAll<HTMLElement>('.workspace-leaf.mod-active .bases-view'));
			const v = views.find((x) => x.offsetParent !== null && x.querySelector('.bases-thead .bases-td'));
			if (!v) return done(null);
			v.scrollTop = t;
			v.scrollLeft = l >= 0 ? l : v.scrollWidth;
			setTimeout(() => {
				const box = v.getBoundingClientRect();
				const head = v.querySelector<HTMLElement>('.bases-thead .bases-td');
				const headBox = head?.getBoundingClientRect();
				const y = box.top + (headBox?.height ?? 30) + 15;
				const hit = document.elementFromPoint(box.left + 8, y)?.closest<HTMLElement>('.bases-tbody .bases-td') ?? null;
				const r = (e: DOMRect | undefined): [number, number] | null => (e ? [Math.round(e.left), Math.round(e.top)] : null);
				const rows = Array.from(v.querySelectorAll<HTMLElement>('.bases-tbody > .bases-tr'));
				done({
					header: r(headBox),
					cell: r(hit?.getBoundingClientRect()),
					cellText: hit?.textContent ?? null,
					frozen: hit?.classList.contains('bfp-frozen') ?? false,
					scroll: [Math.round(v.scrollLeft), Math.round(v.scrollTop)],
					firstCellInDom: rows.length > 0 && rows.every((row) => (row.firstElementChild as HTMLElement | null)?.style.insetInlineStart === '0px'),
				});
			}, 700);
		},
		left,
		top,
	);
}

async function openTable(file: string, mode?: 'source' | 'preview'): Promise<void> {
	await obsidianPage.openFile(`${DIR}/${file}`);
	if (mode) {
		await browser.executeObsidian(async ({ app }, m) => {
			const leaf = app.workspace.getLeaf(false);
			await leaf.setViewState({ type: 'markdown', state: { file: app.workspace.getActiveFile()?.path, mode: m } });
		}, mode);
	}
	await browser.waitUntil(async () => (await probe(0, 0))?.cell != null, { timeout: 15000, timeoutMsg: `no Bases table rows in ${file}` });
}

/** Scrolls far right and 400 px down and checks the header and first column did not move. */
async function expectFrozen(file: string, mode?: 'source' | 'preview'): Promise<void> {
	await openTable(file, mode);
	const before = (await probe(0, 0))!;
	const after = (await probe(-1, 400))!;
	expect(after.scroll[0]).toBeGreaterThan(300);
	expect(after.scroll[1]).toBeGreaterThan(200);
	expect(after.header).toEqual(before.header);
	// Rows scroll by partial heights, so only the x of the first column cell must stay put.
	expect(after.cell?.[0]).toBe(before.cell?.[0]);
	expect(after.frozen).toBe(true);
	expect(after.cellText).not.toBe(before.cellText);
}

async function setColumns(columns: number): Promise<void> {
	await browser.executeObsidian(({ app }, id, n) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, { settings: { columns: number }; refresh(): void }> } }).plugins.plugins[id]!;
		p.settings.columns = n;
		p.refresh();
	}, pluginId, columns);
}

describe(`${pluginId} smoke test`, function () {
	it('is enabled and reloads with no console errors', async function () {
		const state = await reloadPlugin(pluginId);
		expect(state).toEqual({ enabled: true, reloaded: true, errors: [] });
		const supported = await browser.executeObsidian(({ app }, id) => (app as unknown as { plugins: { plugins: Record<string, { columnsSupported: boolean }> } }).plugins.plugins[id]!.columnsSupported, pluginId);
		expect(supported).toBe(true);
	});

	it('keeps the header and the first column in place in a base file', async function () {
		await expectFrozen('Reading log.base');
	});

	it('keeps them in place in an embedded base in live preview', async function () {
		await expectFrozen('Reading notes.md', 'source');
	});

	it('keeps them in place in an embedded base in reading view', async function () {
		await expectFrozen('Reading notes.md', 'preview');
	});

	it('keeps them in place in a base code block', async function () {
		await expectFrozen('Books by country.md', 'source');
	});

	it('with 0 frozen columns the core table drops the first cells after scrolling right', async function () {
		await setColumns(0);
		await openTable('Reading log.base');
		const after = (await probe(-1, 400))!;
		expect(after.firstCellInDom).toBe(false);
		expect(after.frozen).toBe(false);
		await setColumns(1);
		const again = (await probe(-1, 400))!;
		expect(again.firstCellInDom).toBe(true);
		expect(again.frozen).toBe(true);
	});

	it('removes every mark when the plugin is turned off', async function () {
		await browser.executeObsidian(async ({ app }, id) => {
			await (app as unknown as { plugins: { disablePlugin(id: string): Promise<void> } }).plugins.disablePlugin(id);
		}, pluginId);
		const after = (await probe(-1, 300))!;
		expect(await browser.execute(() => document.querySelectorAll('.bfp-frozen, .bfp-row, [data-bfp-columns]').length)).toBe(0);
		expect(after.firstCellInDom).toBe(false);
		await browser.executeObsidian(async ({ app }, id) => {
			await (app as unknown as { plugins: { enablePlugin(id: string): Promise<boolean> } }).plugins.enablePlugin(id);
		}, pluginId);
	});
});
