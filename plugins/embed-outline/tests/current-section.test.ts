import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import EmbedOutlinePlugin from '../src/main';
import { ScrollFollower } from '../src/follow';
import { buildOutline, chainWhere, headingKey, placeChain, sameRow, visibleRow, type OutlineItem, type OutlineOptions, type ViewPlace } from '../src/outline';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import { fakeSource } from './scan';
import manifest from '../manifest.json';

const FREE: OutlineOptions = { callouts: true, listHeadings: true, maxDepth: 1, words: false, broken: false };
const PRO: OutlineOptions = { ...FREE, maxDepth: 5 };

/** A note with lines 0..n-1, each line empty unless set. */
function note(n: number, set: Record<number, string>): string {
	return Array.from({ length: n }, (_, i) => set[i] ?? '').join('\n');
}

const active = (items: readonly OutlineItem[], place: ViewPlace): OutlineItem | null => visibleRow(placeChain(items, place));

describe('current section in the note itself (criterion 1)', () => {
	const o = buildOutline('N.md', fakeSource({ 'N.md': note(25, { 0: '# Zero', 10: '## Ten', 20: '## Twenty' }) }), FREE);
	it('rows at lines 0, 10 and 20 with top line 15 give the row at line 10', () => {
		expect(active(o.items, { kind: 'line', line: 15 })?.text).toBe('Ten');
	});
	it('a row exactly at the top line is the current row', () => {
		expect(active(o.items, { kind: 'line', line: 20 })?.text).toBe('Twenty');
		expect(active(o.items, { kind: 'line', line: 0 })?.text).toBe('Zero');
	});
	it('gives the full chain from the top-level row', () => {
		expect(placeChain(o.items, { kind: 'line', line: 15 }).map((r) => r.text)).toEqual(['Zero', 'Ten']);
	});
	it('gives no row above the first row', () => {
		const late = buildOutline('L.md', fakeSource({ 'L.md': note(6, { 4: '# Late' }) }), FREE);
		expect(placeChain(late.items, { kind: 'line', line: 2 })).toEqual([]);
	});
	it('counts an embed row of the note as an own row', () => {
		const files = { 'N.md': note(30, { 0: '# Zero', 10: '![[Ch]]', 20: '## Twenty' }), 'Ch.md': '# Inside\n' };
		const e = buildOutline('N.md', fakeSource(files), FREE);
		expect(active(e.items, { kind: 'line', line: 12 })?.kind).toBe('embed');
		expect(active(e.items, { kind: 'line', line: 22 })?.text).toBe('Twenty');
	});
});

describe('current section inside an embed', () => {
	const files = {
		'N.md': note(25, { 0: '# Book', 10: '![[Other]]', 20: '![[Ch]]' }),
		'Ch.md': '# A\ntext\n# B\ntext\n',
		'Other.md': '# A\n',
	};
	const o = buildOutline('N.md', fakeSource(files), FREE);

	it('top line inside the embed at line 20 with A at -50 px and B at 30 px gives A (criterion 2)', () => {
		const place: ViewPlace = { kind: 'embed', line: 20, link: 'Ch', headings: [{ text: 'A', top: -50 }, { text: 'B', top: 30 }] };
		const row = active(o.items, place);
		expect(row?.text).toBe('A');
		expect(row?.path).toBe('Ch.md');
		expect(row?.rootLine).toBe(20);
	});

	it('no embedded heading above the top gives the embed row (criterion 3)', () => {
		const place: ViewPlace = { kind: 'embed', line: 20, link: 'Ch', headings: [{ text: 'A', top: 40 }, { text: 'B', top: 300 }] };
		const row = active(o.items, place);
		expect(row?.kind).toBe('embed');
		expect(row?.rootLine).toBe(20);
	});

	it('the last heading at or above the top wins, with a few pixels of slack', () => {
		const place: ViewPlace = { kind: 'embed', line: 20, link: 'Ch', headings: [{ text: 'A', top: -300 }, { text: 'B', top: 2 }] };
		expect(active(o.items, place)?.text).toBe('B');
	});

	it('picks the embed by the line when the link is unknown', () => {
		const place: ViewPlace = { kind: 'embed', line: 11, headings: [{ text: 'A', top: -5 }] };
		expect(active(o.items, place)?.path).toBe('Other.md');
	});

	it('matches the heading text as the jump does: no case, no outer spaces', () => {
		expect(headingKey('  The Ferry ')).toBe(headingKey('the ferry'));
		const place: ViewPlace = { kind: 'embed', line: 20, link: 'Ch', headings: [{ text: ' a ', top: -1 }] };
		expect(active(o.items, place)?.text).toBe('A');
	});

	it('matches repeated heading text by order', () => {
		const rep = buildOutline('R.md', fakeSource({ 'R.md': '![[Ch]]\n', 'Ch.md': '# Notes\n## Notes\n## End\n' }), FREE);
		const place: ViewPlace = { kind: 'embed', line: 0, link: 'Ch', headings: [{ text: 'Notes', top: -40 }, { text: 'Notes', top: -10 }, { text: 'End', top: 50 }] };
		const row = active(rep.items, place);
		expect(row?.text).toBe('Notes');
		expect(row?.level).toBe(2);
	});

	it('skips headings of a locked embed and keeps its parent section (free)', () => {
		const nested = { 'N.md': '![[Ch]]\n', 'Ch.md': '# Ch\n## Letter part\n![[Letter]]\n## After\n', 'Letter.md': '# Letter\n## Page\n' };
		const free = buildOutline('N.md', fakeSource(nested), FREE);
		const headings = [
			{ text: 'Ch', top: -400 },
			{ text: 'Letter part', top: -300 },
			{ text: 'Letter', top: -200 },
			{ text: 'Page', top: -100 },
			{ text: 'After', top: 200 },
		];
		expect(active(free.items, { kind: 'embed', line: 0, link: 'Ch', headings })?.text).toBe('Letter part');
		// Pro opens the nested embed: the same place gives the heading inside it.
		const pro = buildOutline('N.md', fakeSource(nested), PRO);
		const row = active(pro.items, { kind: 'embed', line: 0, link: 'Ch', headings });
		expect(row?.text).toBe('Page');
		expect(row?.depth).toBe(2);
	});
});

describe('folded, locked and searched rows (criterion 4)', () => {
	const files = { 'N.md': note(25, { 0: '# Book', 10: '## Part', 20: '![[Ch]]' }), 'Ch.md': '# A\n## A1\n' };
	const o = buildOutline('N.md', fakeSource(files), FREE);
	const chain = placeChain(o.items, { kind: 'embed', line: 20, link: 'Ch', headings: [{ text: 'A', top: -60 }, { text: 'A1', top: -10 }] });

	it('a match in a folded branch gives the nearest visible parent', () => {
		expect(chain.map((r) => r.text)).toEqual(['Book', 'Part', 'Ch', 'A', 'A1']);
		expect(visibleRow(chain, (r) => r.kind === 'embed')?.kind).toBe('embed');
		expect(visibleRow(chain, (r) => r.text === 'Book')?.text).toBe('Book');
		expect(visibleRow(chain, (r) => r.text === 'A')?.text).toBe('A');
		expect(visibleRow(chain)?.text).toBe('A1');
	});

	it('a locked row is never the result: its visible parent is', () => {
		const nested = buildOutline('N.md', fakeSource({ 'N.md': '# Top\n![[Ch]]\n', 'Ch.md': '# Ch\n![[Deep]]\n', 'Deep.md': '# Deep\n' }), FREE);
		const locked = chainWhere(nested.items, (r) => r.locked === true);
		expect(locked.at(-1)?.locked).toBe(true);
		expect(visibleRow(locked)?.text).toBe('Ch');
	});

	it('an empty chain gives no row', () => {
		expect(visibleRow([])).toBeNull();
	});

	it('finds the same row again in a new build of the outline', () => {
		const again = buildOutline('N.md', fakeSource(files), FREE);
		const pin = chain.at(-1)!;
		const found = chainWhere(again.items, (r) => sameRow(r, pin));
		expect(found.at(-1)).not.toBe(pin);
		expect(found.map((r) => r.text)).toEqual(chain.map((r) => r.text));
	});
});

describe('scroll listener (criteria 7 and 10)', () => {
	afterEach(() => vi.useRealTimers());

	it('updates at most once each 100 ms during a scroll', () => {
		vi.useFakeTimers();
		const update = vi.fn();
		const f = new ScrollFollower(update);
		const el = document.createElement('div');
		f.watch(el);
		expect(f.listening).toBe(true);
		for (let i = 0; i < 10; i++) {
			el.dispatchEvent(new Event('scroll'));
			vi.advanceTimersByTime(20);
		}
		// 200 ms of scroll events: two updates.
		expect(update).toHaveBeenCalledTimes(2);
		vi.advanceTimersByTime(100);
		expect(update).toHaveBeenCalledTimes(2);
	});

	it('stop removes the listener and drops a pending update', () => {
		vi.useFakeTimers();
		const update = vi.fn();
		const f = new ScrollFollower(update);
		const el = document.createElement('div');
		const remove = vi.spyOn(el, 'removeEventListener');
		f.watch(el);
		el.dispatchEvent(new Event('scroll'));
		f.stop();
		vi.advanceTimersByTime(500);
		el.dispatchEvent(new Event('scroll'));
		vi.advanceTimersByTime(500);
		expect(update).not.toHaveBeenCalled();
		expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function), { capture: true });
		expect(f.listening).toBe(false);
	});

	it('a new element replaces the old listener', () => {
		const f = new ScrollFollower(() => undefined);
		const a = document.createElement('div');
		const b = document.createElement('div');
		const remove = vi.spyOn(a, 'removeEventListener');
		f.watch(a);
		f.watch(b);
		expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function), { capture: true });
		f.stop();
	});

	it('tells when the reader moves in the note, and not after stop', () => {
		const user = vi.fn();
		const f = new ScrollFollower(() => undefined, 100, user);
		const el = document.createElement('div');
		f.watch(el);
		el.dispatchEvent(new Event('wheel'));
		el.dispatchEvent(new Event('keydown'));
		expect(user).toHaveBeenCalledTimes(2);
		f.stop();
		el.dispatchEvent(new Event('pointerdown'));
		expect(user).toHaveBeenCalledTimes(2);
	});

	it('the setting is on by default and off stops the listener', async () => {
		expect(DEFAULT_SETTINGS.highlight).toBe(true);
		expect(normalizeSettings({ highlight: 'x' as never }).highlight).toBe(true);
		expect(normalizeSettings({ highlight: false }).highlight).toBe(false);
		const app = App.createConfigured__({ files: { 'a.md': '# A' } });
		const plugin = new EmbedOutlinePlugin(app as never, manifest as never);
		await plugin.loadSettings();
		plugin.settings.highlight = false;
		plugin.syncFollow();
		expect(plugin.following()).toBe(false);
	});
});
