import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { outlineLines, type Outline } from '../../src/outline';
import { MANUSCRIPT_FREE, MANUSCRIPT_PRO } from '../../tests/sample-expect';
import { pluginId } from './load';

// Real-app checks on the sample vault (a copy of docs/sample-notes). The rows come from the app's metadata cache
// and must match the rows that tests/sample.test.ts gets from the test scanner.
const DIR = 'Embed Outline';
const MANUSCRIPT = `${DIR}/Manuscript.md`;
const CHAPTER1 = `${DIR}/Chapters/Chapter 1.md`;

interface State {
	outline: Outline | null;
	rows: number;
	texts: string[];
	stats: string;
	hint: string;
}

async function state(): Promise<State> {
	return browser.executeObsidian(({ app }, id) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, { current(): Outline | null }> } }).plugins.plugins[id]!;
		const view = app.workspace.getLeavesOfType('embed-outline')[0]?.view.containerEl;
		const rows = Array.from(view?.querySelectorAll<HTMLElement>('.embed-outline-row') ?? []);
		return {
			outline: JSON.parse(JSON.stringify(p.current())) as Outline | null,
			rows: rows.length,
			texts: rows.map((r) => r.querySelector('.embed-outline-text')?.textContent ?? ''),
			stats: view?.querySelector('.embed-outline-stats')?.textContent ?? '',
			hint: view?.querySelector('.embed-outline-hint')?.textContent ?? '',
		};
	}, pluginId);
}

const linesOf = (s: State): string[] => (s.outline ? outlineLines(s.outline.items) : []);

async function waitFor(pred: (s: State) => boolean, msg: string, timeout = 15000): Promise<State> {
	const box: { last: State | null } = { last: null };
	const ok = await browser
		.waitUntil(
			async () => {
				box.last = await state();
				return pred(box.last);
			},
			{ timeout, interval: 250 },
		)
		.catch(() => false);
	const last = box.last;
	if (!ok || !last) throw new Error(`${msg}; last ${JSON.stringify(last && { lines: linesOf(last), rows: last.rows, stats: last.stats })}`);
	return last;
}

const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

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

/** Clicks the outline row with this text; mod = Ctrl or Cmd held. */
async function clickRow(text: string, mod = false): Promise<void> {
	const ok = await browser.execute(
		(t: string, m: boolean) => {
			const row = Array.from(document.querySelectorAll<HTMLElement>('.embed-outline-row')).find((r) => r.querySelector('.embed-outline-text')?.textContent === t);
			row?.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: m, metaKey: m }));
			return !!row;
		},
		text,
		mod,
	);
	expect(ok).toBe(true);
}

async function cursorLine(): Promise<{ path: string; line: number }> {
	return browser.executeObsidian(({ app, obsidian }) => {
		const v = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
		return { path: v?.file?.path ?? '', line: v?.editor.getCursor().line ?? -1 };
	});
}

describe(`${pluginId} in the real app`, function () {
	before(async function () {
		await setPro(false);
		await obsidianPage.openFile(MANUSCRIPT);
		await browser.executeObsidianCommand(`${pluginId}:open`);
	});

	it('the core outline lists only the headings of the note itself', async function () {
		const core = await browser.executeObsidian(({ app }, path) => {
			const f = app.vault.getFileByPath(path)!;
			return (app.metadataCache.getFileCache(f)?.headings ?? []).map((h) => h.heading);
		}, MANUSCRIPT);
		expect(core).toEqual(['The Lighthouse Keeper', 'Part one', 'Part two', 'Back matter', 'Revision notes']);
	});

	it('free: shows the embedded chapters, callouts and list headings, with the nested embed locked', async function () {
		const s = await waitFor((x) => same(linesOf(x), MANUSCRIPT_FREE), 'free outline of the manuscript');
		expect(s.rows).toBe(MANUSCRIPT_FREE.length);
		expect(s.outline?.words).toBeUndefined();
		expect(s.stats).toBe('5 embeds');
		expect(s.hint).toBe('1 embed sits inside embedded notes. Pro opens them.');
		expect(s.texts).toContain('Chapter 4 > The storm');
	});

	it('free search shows an embedded heading with its parent rows and keeps its jump target', async function () {
		await browser.execute(() => {
			const input = document.querySelector<HTMLInputElement>('.embed-outline-search input')!;
			input.value = ' FERRY ';
			input.dispatchEvent(new Event('input', { bubbles: true }));
		});
		const s = await waitFor((x) => x.rows === 5, 'search result and parent rows');
		expect(s.texts).toEqual(['The Lighthouse Keeper', 'Part one', 'Chapter 1', 'Chapter 1: Arrival', 'The ferry']);
		expect(linesOf(s)).toEqual(MANUSCRIPT_FREE);
		await clickRow('The ferry');
		await browser.waitUntil(async () => (await cursorLine()).line === 10, { timeout: 5000 });
		await browser.execute(() => document.querySelector<HTMLButtonElement>('[aria-label="Clear outline search"]')!.click());
		await waitFor((x) => x.rows === MANUSCRIPT_FREE.length, 'full outline after clear');
	});

	it('search opens a folded path and Escape restores the fold state', async function () {
		await browser.execute(() => {
			document.querySelector<HTMLButtonElement>('[aria-label="Fold all"]')!.click();
			const input = document.querySelector<HTMLInputElement>('.embed-outline-search input')!;
			input.value = 'ferry';
			input.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await waitFor((x) => x.texts.includes('The ferry'), 'folded match is visible');
		await browser.execute(() => document.querySelector('.embed-outline-search input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
		await waitFor((x) => x.rows === 1, 'fold state after Escape');
		await browser.execute(() => document.querySelector<HTMLButtonElement>('[aria-label="Fold all"]')!.click());
		await waitFor((x) => x.rows === MANUSCRIPT_FREE.length, 'all rows open again');
	});

	it('search shows no matches and clears on a note change', async function () {
		await browser.execute(() => {
			const input = document.querySelector<HTMLInputElement>('.embed-outline-search input')!;
			input.value = 'no-such-row';
			input.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await waitFor((x) => x.rows === 0, 'no matches');
		const status = await browser.execute(() => document.querySelector('.embed-outline-search-status')?.textContent);
		expect(status).toBe('0 matches');
		await obsidianPage.openFile(CHAPTER1);
		await waitFor((x) => x.outline?.path === CHAPTER1 && x.rows > 0, 'search cleared for Chapter 1');
		const query = await browser.execute(() => document.querySelector<HTMLInputElement>('.embed-outline-search input')?.value);
		expect(query).toBe('');
		await obsidianPage.openFile(MANUSCRIPT);
		await waitFor((x) => x.rows === MANUSCRIPT_FREE.length, 'manuscript after search');
	});

	it('a click on an own heading moves the cursor to that heading', async function () {
		await clickRow('Revision notes');
		await browser.waitUntil(async () => (await cursorLine()).line === 27, { timeout: 5000, timeoutMsg: 'cursor did not move to line 27' });
		expect((await cursorLine()).path).toBe(MANUSCRIPT);
	});

	it('a click on a heading of an embedded note moves to the embed and shows that heading', async function () {
		await clickRow('A letter in the drawer');
		await browser.waitUntil(async () => (await cursorLine()).line === 12, { timeout: 5000, timeoutMsg: 'cursor did not move to the embed line 12' });
		const visible = await browser.waitUntil(
			async () =>
				browser.execute(() => {
					const h = Array.from(document.querySelectorAll<HTMLElement>('.workspace-leaf.mod-active .markdown-embed [data-heading]')).find((e) => e.getAttribute('data-heading') === 'A letter in the drawer');
					if (!h) return false;
					const r = h.getBoundingClientRect();
					return r.top >= 0 && r.bottom <= window.innerHeight;
				}),
			{ timeout: 5000, timeoutMsg: 'the embedded heading is not in view' },
		);
		expect(visible).toBe(true);
	});

	it('Ctrl or Cmd click opens the embedded note in a new tab', async function () {
		await clickRow('The keeper\'s house', true);
		await browser.waitUntil(async () => (await cursorLine()).path === CHAPTER1, { timeout: 5000, timeoutMsg: 'Chapter 1 did not open' });
		await obsidianPage.openFile(MANUSCRIPT);
		await waitFor((x) => x.outline?.path === MANUSCRIPT, 'outline back on the manuscript');
	});

	it('updates when an embedded note changes', async function () {
		const before = await browser.executeObsidian(async ({ app }, path) => app.vault.read(app.vault.getFileByPath(path)!), CHAPTER1);
		await obsidianPage.write(CHAPTER1, `${before}\n## Postscript\n\nOne more line.\n`);
		await waitFor((x) => linesOf(x).includes('        H2 Postscript @10'), 'new heading in the embedded note');
		await obsidianPage.write(CHAPTER1, before);
		await waitFor((x) => same(linesOf(x), MANUSCRIPT_FREE), 'outline after the undo');
	});

	it('free: the copy command asks for Pro and copies nothing', async function () {
		const text = await browser.executeObsidian(async ({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, { copyOutline(): Promise<string | null> }> } }).plugins.plugins[id]!;
			return p.copyOutline();
		}, pluginId);
		expect(text).toBeNull();
	});

	it('pro: nested embeds, word counts and the broken embed', async function () {
		await setPro(true);
		const s = await waitFor((x) => same(linesOf(x), MANUSCRIPT_PRO), 'pro outline of the manuscript');
		expect(s.outline?.words).toBe(439);
		expect(s.stats).toBe('5 embeds, 439 words, 1 broken');
		expect(s.hint).toBe('');
		expect(s.texts).toContain('No such note: Acknowledgments');
	});

	it('pro: copies the outline as a linked Markdown list', async function () {
		const text = await browser.executeObsidian(async ({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, { copyOutline(): Promise<string | null> }> } }).plugins.plugins[id]!;
			return p.copyOutline();
		}, pluginId);
		const lines = (text ?? '').split('\n');
		expect(lines[0]).toBe('- [[Manuscript#The Lighthouse Keeper|The Lighthouse Keeper]] (439 words)');
		expect(lines).toContain('\t\t\t- [[Chapter 1#Chapter 1 Arrival|Chapter 1: Arrival]] (99 words)');
		expect(lines).toContain('\t\t- Missing note: `Acknowledgments`');
		expect(lines.filter(Boolean).length).toBe(MANUSCRIPT_PRO.length);
	});

	it('pro off again: back to the free outline', async function () {
		await setPro(false);
		await waitFor((x) => same(linesOf(x), MANUSCRIPT_FREE), 'free outline after sign out');
	});
});
