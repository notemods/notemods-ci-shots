import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId } from './load';

// Acceptance tests A1 to A10 of the spec, in the core Bases cards view.
const DIR = 'Bases Card Wrap';
const BASE = `${DIR}/Quotes.base`;
const SEP = '\u0000';
const KEY = `${BASE}${SEP}Quotes`;
const ORDER = ['file.name', 'quote', 'author', 'added', 'tags'];

interface Rule {
	props: Record<string, { mode: string; lines: number }>;
	all: { mode: string; lines: number };
}

interface Card {
	top: number;
	bottom: number;
	left: number;
	/** clientHeight, scrollHeight and line height (px) of each property line, title first. */
	lines: { h: number; sh: number; lh: number; text: string; textW: number; ws: string }[];
	/** Bottom of the last property element. */
	contentBottom: number;
}

interface Probe {
	on: boolean;
	cards: Card[];
	scrollTop: number;
}

async function setRule(key: string, rule: Rule | null): Promise<void> {
	await browser.executeObsidian(async ({ app }, id, k, r) => {
		const plugin = (app as unknown as { plugins: { plugins: Record<string, { setViewRule(k: string, r: unknown): Promise<void> }> } }).plugins.plugins[id]!;
		await plugin.setViewRule(k, r);
	}, pluginId, key, rule);
	await browser.pause(400);
}

async function settingsViews(): Promise<string[]> {
	return browser.executeObsidian(({ app }, id) => {
		const plugin = (app as unknown as { plugins: { plugins: Record<string, { settings: { views: Record<string, unknown> } }> } }).plugins.plugins[id]!;
		return Object.keys(plugin.settings.views);
	}, pluginId);
}

/** Measures the visible cards of the first shown cards view in the active tab (index picks a later view). */
async function probe(index = 0): Promise<Probe | null> {
	return browser.execute((i: number) => {
		const views = Array.from(document.querySelectorAll<HTMLElement>('.workspace-leaf.mod-active .bases-view[data-view-type="cards"]')).filter((v) => v.offsetParent !== null);
		const v = views[i];
		if (!v) return null;
		const items = Array.from(v.querySelectorAll<HTMLElement>('.bases-cards-item')).filter((c) => (c.parentElement as HTMLElement).style.opacity !== '0');
		const cards = items.map((c) => {
			const r = c.getBoundingClientRect();
			const props = Array.from(c.querySelectorAll<HTMLElement>(':scope > .bases-cards-property'));
			const lines = props.map((p) => {
				const line = p.querySelector<HTMLElement>('.bases-cards-line')!;
				const cs = getComputedStyle(line);
				const range = document.createRange();
				range.selectNodeContents(line);
				return { h: line.clientHeight, sh: line.scrollHeight, lh: parseFloat(cs.lineHeight) || 0, text: line.innerText, textW: Math.round(range.getBoundingClientRect().width), ws: cs.whiteSpace };
			});
			const last = props[props.length - 1];
			return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), lines, contentBottom: last ? Math.round(last.getBoundingClientRect().bottom) : Math.round(r.top) };
		});
		const scroller = v.closest('.view-content') ?? v;
		return { on: v.classList.contains('bcw-on'), cards, scrollTop: Math.round((scroller as HTMLElement).scrollTop) };
	}, index);
}

async function openBase(path = BASE): Promise<void> {
	await obsidianPage.openFile(path);
	await browser.waitUntil(async () => ((await probe())?.cards.length ?? 0) > 0, { timeout: 20000, timeoutMsg: 'no cards' });
	await browser.pause(300);
}

/** Cards in one row share a top edge, a row starts below the row above, and the content fits in each card. */
function checkGrid(p: Probe): void {
	const rows = new Map<number, Card[]>();
	for (const c of p.cards) rows.set(c.top, [...(rows.get(c.top) ?? []), c]);
	const tops = [...rows.keys()].sort((a, b) => a - b);
	expect(tops.length).toBeGreaterThan(0);
	for (let i = 1; i < tops.length; i++) {
		const above = Math.max(...rows.get(tops[i - 1]!)!.map((c) => c.bottom));
		expect(tops[i]!).toBeGreaterThanOrEqual(above);
	}
	const heights = new Set(p.cards.map((c) => c.bottom - c.top));
	expect(heights.size).toBe(1);
	for (const c of p.cards) expect(c.contentBottom).toBeLessThanOrEqual(c.bottom + 1);
}

describe(`${pluginId} card wrap`, function () {
	let core: Probe;

	before(async function () {
		await setRule(KEY, null);
		await openBase();
		core = (await probe())!;
	});

	afterEach(async function () {
		await setRule(KEY, null);
	});

	it('A0 core look: one line for each property without a rule', async function () {
		expect(core.on).toBe(false);
		for (const c of core.cards) for (const l of c.lines) expect(l.ws).toBe('nowrap');
		checkGrid(core);
	});

	it('A2 clamps the quote to 2 and then 4 lines, and the grid stays aligned', async function () {
		for (const n of [2, 4]) {
			await setRule(KEY, { props: { 'note.quote': { mode: 'clamp', lines: n } }, all: { mode: 'core', lines: 3 } });
			const p = (await probe())!;
			expect(p.on).toBe(true);
			for (const c of p.cards) {
				const q = c.lines[1]!;
				expect(Math.abs(q.h - n * q.lh)).toBeLessThanOrEqual(1);
				expect(c.lines[2]!.ws).toBe('nowrap');
			}
			checkGrid(p);
			// The card grows by the extra lines only.
			const coreH = core.cards[0]!.bottom - core.cards[0]!.top;
			const h = p.cards[0]!.bottom - p.cards[0]!.top;
			const lh = p.cards[0]!.lines[1]!.lh;
			expect(Math.abs(h - coreH - (n - 1) * lh)).toBeLessThanOrEqual(6);
		}
	});

	it('A1 wrap with 10 lines shows the full long quote', async function () {
		await setRule(KEY, { props: { 'note.quote': { mode: 'wrap', lines: 10 } }, all: { mode: 'core', lines: 3 } });
		const p = (await probe())!;
		const seneca = p.cards.find((c) => c.lines[0]!.text.includes('Seneca'))!;
		expect(seneca).toBeTruthy();
		const q = seneca.lines[1]!;
		expect(q.ws).toBe('normal');
		expect(q.text).toContain('highest achievements if it were all well invested.');
		// The whole value fits in the box: no hidden part.
		expect(q.sh).toBeLessThanOrEqual(q.h + 1);
		checkGrid(p);
	});

	it('A1 wrap with 2 lines scrolls inside the box to the end of the value', async function () {
		await setRule(KEY, { props: {}, all: { mode: 'wrap', lines: 2 } });
		const p = (await probe())!;
		const seneca = p.cards.find((c) => c.lines[0]!.text.includes('Seneca'))!;
		expect(seneca.lines[1]!.sh).toBeGreaterThan(seneca.lines[1]!.h + 1);
		const scrolled = await browser.execute(() => {
			const card = Array.from(document.querySelectorAll<HTMLElement>('.workspace-leaf.mod-active .bases-cards-item')).find((c) => c.innerText.includes('Seneca'))!;
			const line = card.querySelectorAll<HTMLElement>('.bases-cards-line')[1]!;
			line.scrollTop = 10000;
			return getComputedStyle(line).overflowY + ' ' + String(line.scrollTop > 0);
		});
		expect(scrolled).toBe('auto true');
		checkGrid(p);
	});

	it('A3 title on 2 lines and every property on 3 lines keep one card height per row', async function () {
		await setRule(KEY, { props: { 'file.name': { mode: 'clamp', lines: 2 }, 'note.author': { mode: 'core', lines: 3 } }, all: { mode: 'clamp', lines: 3 } });
		const p = (await probe())!;
		for (const c of p.cards) {
			expect(Math.abs(c.lines[0]!.h - 2 * c.lines[0]!.lh)).toBeLessThanOrEqual(1);
			expect(Math.abs(c.lines[1]!.h - 3 * c.lines[1]!.lh)).toBeLessThanOrEqual(1);
			expect(c.lines[2]!.ws).toBe('nowrap');
		}
		checkGrid(p);
	});

	it('A8 a date value shows in full with a rule on every property', async function () {
		await setRule(KEY, { props: {}, all: { mode: 'clamp', lines: 2 } });
		const p = (await probe())!;
		for (let i = 0; i < p.cards.length; i++) {
			const before = core.cards[i]!.lines[3]!;
			const after = p.cards[i]!.lines[3]!;
			expect(after.text).toBe(before.text);
			expect(after.text.length).toBeGreaterThan(4);
			expect(Math.abs(after.textW - before.textW)).toBeLessThanOrEqual(2);
		}
	});

	it('A10 edit after create: clamp 2, then 4, then no rule; the scroll position stays', async function () {
		await browser.setWindowSize(1200, 500);
		await openBase();
		await setRule(KEY, { props: { 'note.quote': { mode: 'clamp', lines: 2 } }, all: { mode: 'core', lines: 3 } });
		await browser.execute(() => {
			const s = document.querySelector<HTMLElement>('.workspace-leaf.mod-active .view-content');
			if (s) s.scrollTop = 120;
		});
		await browser.pause(300);
		const a = (await probe())!;
		await setRule(KEY, { props: { 'note.quote': { mode: 'clamp', lines: 4 } }, all: { mode: 'core', lines: 3 } });
		const b = (await probe())!;
		expect(b.scrollTop).toBe(a.scrollTop);
		for (const c of b.cards) expect(Math.abs(c.lines[1]!.h - 4 * c.lines[1]!.lh)).toBeLessThanOrEqual(1);
		await setRule(KEY, null);
		const c = (await probe())!;
		expect(c.on).toBe(false);
		for (const card of c.cards) expect(card.lines[1]!.ws).toBe('nowrap');
		await browser.setWindowSize(1200, 800);
	});

	it('A10 the command opens the modal and a change in it applies at once', async function () {
		await openBase();
		await browser.executeObsidianCommand(`${pluginId}:set-view-rule`);
		await browser.waitUntil(async () => (await browser.$$('.bcw-modal .bcw-rule-row').length) === 1 + ORDER.length, { timeout: 5000, timeoutMsg: 'modal rows' });
		const names = await browser.execute(() => Array.from(document.querySelectorAll('.bcw-modal .bcw-rule-row .setting-item-name')).map((e) => (e as HTMLElement).innerText));
		expect(names[0]).toBe('All properties');
		expect(names[1]).toBe('file name (title)');
		expect(names[2]).toBe('Quote');
		await browser.execute(() => {
			const sel = document.querySelectorAll<HTMLSelectElement>('.bcw-modal .bcw-rule-row')[2]!.querySelector('select')!;
			sel.value = 'clamp';
			sel.dispatchEvent(new Event('change'));
		});
		await browser.pause(500);
		const views = await browser.executeObsidian(({ app }, id) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, { settings: { views: Record<string, unknown> } }> } }).plugins.plugins[id]!;
			return plugin.settings.views;
		}, pluginId);
		expect(views[KEY]).toEqual({ props: { 'note.quote': { mode: 'clamp', lines: 3 } }, all: { mode: 'core', lines: 3 } });
		const p = (await probe())!;
		expect(Math.abs(p.cards[0]!.lines[1]!.h - 3 * p.cards[0]!.lines[1]!.lh)).toBeLessThanOrEqual(1);
		await browser.keys('Escape');
	});

	it('A9 a rule of one view does not change another view of the same base', async function () {
		await setRule(KEY, { props: {}, all: { mode: 'clamp', lines: 3 } });
		await browser.executeObsidian(async ({ app }, path) => {
			const leaf = app.workspace.getLeaf(false);
			await leaf.setViewState({ type: 'bases', state: { file: path, viewName: 'Plain' } });
		}, BASE);
		await browser.waitUntil(async () => (await browser.execute(() => document.querySelector('.workspace-leaf.mod-active .bases-view')?.getAttribute('data-view-name'))) === 'Plain', { timeout: 10000 });
		await browser.pause(400);
		const p = (await probe())!;
		expect(p.on).toBe(false);
	});

	for (const mode of ['source', 'preview'] as const) {
		it(`A4 the embedded base gets the rule of its view in ${mode} mode`, async function () {
			await setRule(KEY, { props: { 'note.quote': { mode: 'clamp', lines: 2 } }, all: { mode: 'core', lines: 3 } });
			await obsidianPage.openFile(`${DIR}/Reading list.md`);
			await browser.executeObsidian(async ({ app }, m) => {
				const leaf = app.workspace.getLeaf(false);
				await leaf.setViewState({ type: 'markdown', state: { file: `Bases Card Wrap/Reading list.md`, mode: m, source: false } });
			}, mode);
			await browser.waitUntil(async () => ((await probe())?.on ?? false) === true, { timeout: 15000, timeoutMsg: 'embed has no rule' });
			const p = (await probe())!;
			for (const c of p.cards) expect(Math.abs(c.lines[1]!.h - 2 * c.lines[1]!.lh)).toBeLessThanOrEqual(1);
			checkGrid(p);
			// The base code block has no file: the free rule of Quotes does not reach it.
			const block = await probe(1);
			if (block) expect(block.on).toBe(false);
		});
	}

	it('A7 a renamed base and a renamed view keep the rule', async function () {
		await setRule(KEY, { props: {}, all: { mode: 'clamp', lines: 2 } });
		await browser.executeObsidian(async ({ app }, from) => {
			await app.fileManager.renameFile(app.vault.getFileByPath(from)!, 'Bases Card Wrap/Sayings.base');
		}, BASE);
		await browser.pause(500);
		expect(await settingsViews()).toEqual([`${DIR}/Sayings.base${SEP}Quotes`]);
		await openBase(`${DIR}/Sayings.base`);
		expect((await probe())!.on).toBe(true);
		// Rename the view in the .base file.
		await browser.executeObsidian(async ({ app }) => {
			await app.vault.process(app.vault.getFileByPath('Bases Card Wrap/Sayings.base')!, (t) => t.replace('name: Quotes', 'name: Sayings'));
		});
		await browser.waitUntil(async () => (await settingsViews()).includes(`${DIR}/Sayings.base${SEP}Sayings`), { timeout: 5000, timeoutMsg: 'view rule did not move' });
		// Restore the file names for the other tests.
		await browser.executeObsidian(async ({ app }) => {
			await app.vault.process(app.vault.getFileByPath('Bases Card Wrap/Sayings.base')!, (t) => t.replace('name: Sayings', 'name: Quotes'));
			await app.fileManager.renameFile(app.vault.getFileByPath('Bases Card Wrap/Sayings.base')!, 'Bases Card Wrap/Quotes.base');
		});
		await browser.waitUntil(async () => (await settingsViews()).includes(KEY), { timeout: 5000, timeoutMsg: 'rule did not come back' });
	});

	it('A6 disabling the plugin restores the core look and card height', async function () {
		await setRule(KEY, { props: {}, all: { mode: 'clamp', lines: 3 } });
		await openBase();
		expect((await probe())!.on).toBe(true);
		await browser.executeObsidian(async ({ app }, id) => {
			await (app as unknown as { plugins: { disablePlugin(id: string): Promise<void> } }).plugins.disablePlugin(id);
		}, pluginId);
		await browser.pause(600);
		const p = (await probe())!;
		expect(p.on).toBe(false);
		expect(p.cards[0]!.bottom - p.cards[0]!.top).toBe(core.cards[0]!.bottom - core.cards[0]!.top);
		for (const c of p.cards) for (const l of c.lines) expect(l.ws).toBe('nowrap');
		checkGrid(p);
		await browser.executeObsidian(async ({ app }, id) => {
			await (app as unknown as { plugins: { enablePlugin(id: string): Promise<boolean> } }).plugins.enablePlugin(id);
		}, pluginId);
		await browser.pause(600);
		// The saved rule comes back after enable.
		await browser.waitUntil(async () => (await probe())?.on === true, { timeout: 5000, timeoutMsg: 'rule not back after enable' });
	});

	it('A5 1,000 notes: the view draws, scrolls without long frames, and keeps the grid', async function () {
		this.timeout(240_000);
		await browser.executeObsidian(async ({ app }) => {
			const folder = 'Bases Card Wrap/Many';
			if (!app.vault.getFolderByPath(folder)) await app.vault.createFolder(folder);
			for (let i = 0; i < 1000; i++) {
				const p = `${folder}/Item ${String(i).padStart(4, '0')}.md`;
				if (!app.vault.getFileByPath(p)) await app.vault.create(p, `---\nquote: "Item ${i} has a long value that runs past the width of one card, so it needs more than one line to read in full."\nauthor: Gen\n---\n`);
			}
			const base = 'Bases Card Wrap/Many.base';
			if (!app.vault.getFileByPath(base)) await app.vault.create(base, 'filters:\n  and:\n    - file.inFolder("Bases Card Wrap/Many")\nviews:\n  - type: cards\n    name: Many\n    order:\n      - file.name\n      - quote\n      - author\n');
		});
		await setRule(`${DIR}/Many.base${SEP}Many`, { props: { 'note.quote': { mode: 'clamp', lines: 3 } }, all: { mode: 'core', lines: 3 } });
		await openBase(`${DIR}/Many.base`);
		const result = await browser.executeAsync((done: (r: { maxGap: number; total: number; scrolled: number }) => void) => {
			const s = document.querySelector<HTMLElement>('.workspace-leaf.mod-active .view-content')!;
			let last = performance.now();
			let maxGap = 0;
			const start = last;
			let step = 0;
			const tick = (): void => {
				const now = performance.now();
				maxGap = Math.max(maxGap, now - last);
				last = now;
				if (step++ < 60) {
					s.scrollTop += 900;
					requestAnimationFrame(tick);
				} else done({ maxGap: Math.round(maxGap), total: Math.round(now - start), scrolled: s.scrollTop });
			};
			requestAnimationFrame(tick);
		});
		console.log(`A5 1000 notes: ${JSON.stringify(result)}`);
		expect(result.scrolled).toBeGreaterThan(20000);
		expect(result.maxGap).toBeLessThan(500);
		await browser.pause(300);
		const p = (await probe())!;
		expect(p.on).toBe(true);
		for (const c of p.cards) expect(Math.abs(c.lines[1]!.h - 3 * c.lines[1]!.lh)).toBeLessThanOrEqual(1);
		checkGrid(p);
		await setRule(`${DIR}/Many.base${SEP}Many`, null);
	});
});
