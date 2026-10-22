import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId } from './load';

// "Highlight the current section" in the real app, in live preview and in reading view.
const MANUSCRIPT = 'Embed Outline/Manuscript.md';
const TARGET = 'Chapter 2: The logbook';

type Mode = 'live preview' | 'reading';

interface Plugin {
	settings: { highlight: boolean };
	following(): boolean;
	refreshViews(): void;
	current(): unknown;
}

/** Texts of the rows with the current section mark, with their aria-current values. */
async function activeRows(): Promise<{ texts: string[]; aria: (string | null)[] }> {
	return browser.execute(() => {
		const rows = Array.from(document.querySelectorAll<HTMLElement>('.embed-outline-row.is-active'));
		return { texts: rows.map((r) => r.querySelector('.embed-outline-text')?.textContent ?? ''), aria: rows.map((r) => r.getAttribute('aria-current')) };
	});
}

async function setMode(mode: Mode): Promise<void> {
	await browser.executeObsidian(async ({ app, obsidian }, path, m) => {
		const leaf = app.workspace.getLeavesOfType('markdown').find((l) => l.view instanceof obsidian.MarkdownView && l.view.file?.path === path)!;
		app.workspace.setActiveLeaf(leaf, { focus: true });
		const state = leaf.getViewState();
		await leaf.setViewState({ ...state, state: { ...state.state, mode: m === 'reading' ? 'preview' : 'source', source: false } });
	}, MANUSCRIPT, mode);
	await browser.waitUntil(
		async () =>
			browser.executeObsidian(({ app, obsidian }, m) => {
				const v = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
				return v?.getMode() === (m === 'reading' ? 'preview' : 'source');
			}, mode),
		{ timeout: 5000, timeoutMsg: `the note did not switch to ${mode}` },
	);
}

/**
 * Scrolls the note so the heading TARGET inside the second embedded chapter sits `offset` pixels below the top of the
 * visible area. With `measure`, waits in the page for the row TARGET to get the mark and returns the time in ms.
 */
async function scrollTarget(mode: Mode, offset: number, measure: boolean): Promise<number> {
	return browser.executeObsidian(
		async ({ app, obsidian }, m, text, off, wait) => {
			const v = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;
			const sc = v.contentEl.querySelector<HTMLElement>(m === 'reading' ? '.markdown-reading-view .markdown-preview-view' : '.markdown-source-view .cm-scroller')!;
			const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
			const find = (): HTMLElement | undefined =>
				Array.from(sc.querySelectorAll<HTMLElement>('.markdown-embed [data-heading]')).find((h) => h.getAttribute('data-heading') === text && h.getBoundingClientRect().height > 0);
			// Bring the embed into the drawn part of the note first, then place the heading exactly.
			for (let i = 0; i < 40 && !find(); i++) {
				v.currentMode.applyScroll(12);
				await sleep(100);
			}
			const h = find();
			if (!h) throw new Error(`heading ${text} not drawn`);
			const t0 = performance.now();
			sc.scrollTop += h.getBoundingClientRect().top - sc.getBoundingClientRect().top - off;
			if (!wait) return 0;
			for (;;) {
				const row = Array.from(document.querySelectorAll<HTMLElement>('.embed-outline-row.is-active')).find((r) => r.querySelector('.embed-outline-text')?.textContent === text);
				const ms = performance.now() - t0;
				if (row || ms > 3000) return ms;
				await sleep(5);
			}
		},
		mode,
		TARGET,
		offset,
		measure,
	);
}

describe(`${pluginId}: highlight the current section`, function () {
	before(async function () {
		await obsidianPage.openFile(MANUSCRIPT);
		await browser.executeObsidianCommand(`${pluginId}:open`);
		await browser.waitUntil(async () => browser.execute(() => document.querySelectorAll('.embed-outline-row').length > 20), { timeout: 15000, timeoutMsg: 'outline rows not drawn' });
		const following = await browser.executeObsidian(({ app }, id) => (app as unknown as { plugins: { plugins: Record<string, Plugin> } }).plugins.plugins[id]!.following(), pluginId);
		expect(following).toBe(true);
	});

	for (const mode of ['live preview', 'reading'] as const) {
		it(`${mode}: scrolling to the second embedded chapter marks its first heading within 300 ms`, async function () {
			await setMode(mode);
			// 120 px above the heading: the chapter heading is not yet at the top.
			await scrollTarget(mode, 120, false);
			await browser.pause(400);
			expect((await activeRows()).texts).not.toContain(TARGET);
			const ms = await scrollTarget(mode, -2, true);
			const rows = await activeRows();
			expect(rows.texts).toEqual([TARGET]);
			expect(rows.aria).toEqual(['location']);
			expect(ms).toBeLessThanOrEqual(300);
		});
	}

	it('a click on a row of an embedded heading makes that row the current section', async function () {
		await setMode('live preview');
		await browser.execute(() => {
			const row = Array.from(document.querySelectorAll<HTMLElement>('.embed-outline-row')).find((r) => r.querySelector('.embed-outline-text')?.textContent === 'A letter in the drawer');
			row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		});
		await browser.waitUntil(async () => (await activeRows()).texts.join() === 'A letter in the drawer', { timeout: 3000, timeoutMsg: 'the clicked row is not the current section' });
		await browser.pause(700);
		expect((await activeRows()).texts).toEqual(['A letter in the drawer']);
	});

	it('with the setting off, no row is marked and no scroll listener is registered', async function () {
		await browser.executeObsidian(({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, Plugin> } }).plugins.plugins[id]!;
			p.settings.highlight = false;
			p.refreshViews();
		}, pluginId);
		await browser.waitUntil(async () => (await activeRows()).texts.length === 0, { timeout: 3000, timeoutMsg: 'a row still has the mark' });
		await scrollTarget('live preview', -2, false);
		await browser.pause(400);
		expect((await activeRows()).texts).toEqual([]);
		const following = await browser.executeObsidian(({ app }, id) => (app as unknown as { plugins: { plugins: Record<string, Plugin> } }).plugins.plugins[id]!.following(), pluginId);
		expect(following).toBe(false);
		await browser.executeObsidian(({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, Plugin> } }).plugins.plugins[id]!;
			p.settings.highlight = true;
			p.refreshViews();
		}, pluginId);
		await browser.waitUntil(async () => browser.executeObsidian(({ app }, id) => (app as unknown as { plugins: { plugins: Record<string, Plugin> } }).plugins.plugins[id]!.following(), pluginId), { timeout: 3000, timeoutMsg: 'the listener did not start again' });
	});
});
