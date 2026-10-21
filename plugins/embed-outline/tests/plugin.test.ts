import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import EmbedOutlinePlugin from '../src/main';
import { MAX_DEPTH } from '../src/outline';
import { PRO_UI, SPONSORS, bindPro, isPro, onProChange, resetPro } from '../src/pro';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import { noteData } from '../src/source';
import { brokenLabel, embedLabel } from '../src/view';
import manifest from '../manifest.json';

afterEach(() => resetPro());

/** A stand-in for the SponsorsManager: only isPro and onChange, which the facade uses. */
function fakeManager(start: boolean) {
	let pro = start;
	const fns = new Set<() => void>();
	return {
		isPro: () => pro,
		onChange: (fn: () => void) => {
			fns.add(fn);
			return () => fns.delete(fn);
		},
		set(v: boolean) {
			pro = v;
			for (const fn of fns) fn();
		},
		listeners: () => fns.size,
	};
}

describe('settings', () => {
	it('loads with default settings against an in-memory vault', async () => {
		const app = App.createConfigured__({ files: { 'notes/a.md': '# Hello world' } });
		const plugin = new EmbedOutlinePlugin(app as never, manifest as never);
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(isPro()).toBe(false);
	});

	it('repairs bad saved settings and clamps the depth', () => {
		expect(normalizeSettings({ callouts: 'x' as never, depth: 'deep' as never })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ depth: 0 }).depth).toBe(1);
		expect(normalizeSettings({ depth: 40 }).depth).toBe(MAX_DEPTH);
		expect(normalizeSettings({ depth: 2.4 }).depth).toBe(2);
		expect(normalizeSettings({ words: false, listHeadings: false })).toMatchObject({ words: false, listHeadings: false, callouts: true });
	});
});

describe('free and pro options', () => {
	it('free: depth 1, no word counts, no broken marks, whatever the settings say', async () => {
		const app = App.createConfigured__({ files: {} });
		const plugin = new EmbedOutlinePlugin(app as never, manifest as never);
		await plugin.loadSettings();
		expect(plugin.options()).toEqual({ callouts: true, listHeadings: true, maxDepth: 1, words: false, broken: false });
	});

	it('pro: the settings apply', async () => {
		const app = App.createConfigured__({ files: {} });
		const plugin = new EmbedOutlinePlugin(app as never, manifest as never);
		await plugin.loadSettings();
		bindPro(fakeManager(true) as never);
		plugin.settings = normalizeSettings({ depth: 3, words: false });
		expect(plugin.options()).toEqual({ callouts: true, listHeadings: true, maxDepth: 3, words: false, broken: true });
	});
});

describe('pro facade', () => {
	it('follows the GitHub Sponsors manager and tells listeners on each change', () => {
		const m = fakeManager(false);
		bindPro(m as never);
		const cb = vi.fn();
		const off = onProChange(cb);
		m.set(true);
		expect(isPro()).toBe(true);
		expect(cb).toHaveBeenCalledTimes(1);
		off();
		m.set(false);
		expect(cb).toHaveBeenCalledTimes(1);
		expect(isPro()).toBe(false);
	});

	it('reset unbinds the manager', () => {
		const m = fakeManager(true);
		bindPro(m as never);
		expect(m.listeners()).toBe(1);
		resetPro();
		expect(m.listeners()).toBe(0);
		expect(isPro()).toBe(false);
	});

	it('the sponsor terms match product.yaml', () => {
		expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', sponsorLogin: 'theluckystrike', minMonthlyUsd: 5, oneTimeUsd: 15, oneTimeMonths: 0, scope: 'read:user' });
		expect(PRO_UI.priceText).toBe('Sponsor $5 a month, or $15 once. When you have paid $15 in total, Pro stays on.');
	});
});

describe('noteData from the metadata cache', () => {
	const pos = (line: number) => ({ start: { line, col: 0, offset: 0 }, end: { line, col: 0, offset: 0 } });
	it('takes headings, embeds, callout titles and list headings', () => {
		const text = '# Title\n> [!tip] Hint\n- ## Idea\n![[Other#Part]]\r\nend';
		const cache = {
			headings: [{ heading: 'Title', level: 1, position: pos(0) }],
			sections: [
				{ type: 'heading', position: pos(0) },
				{ type: 'callout', position: pos(1) },
				{ type: 'list', position: pos(2) },
			],
			listItems: [{ parent: -1, position: pos(2) }],
			embeds: [{ link: 'Other#Part', original: '![[Other#Part]]', position: pos(3) }],
		};
		expect(noteData('N.md', text, cache as never)).toEqual({
			path: 'N.md',
			lines: ['# Title', '> [!tip] Hint', '- ## Idea', '![[Other#Part]]', 'end'],
			headings: [{ text: 'Title', level: 1, line: 0 }],
			embeds: [{ link: 'Other#Part', line: 3 }],
			callouts: [{ line: 1, type: 'tip', title: 'Hint' }],
			listHeadings: [{ line: 2, level: 2, text: 'Idea' }],
		});
	});
	it('works with no cache entry', () => {
		expect(noteData('N.md', '# x', null).headings).toEqual([]);
	});
});

describe('row labels', () => {
	const base = { path: 'a.md', line: 0, rootLine: 0, level: 0, depth: 1, children: [] };
	it('names an embed by note and part', () => {
		expect(embedLabel({ ...base, kind: 'embed', text: '', link: 'Folder/Chapter 1#Scene#Beat' })).toBe('Chapter 1 > Scene > Beat');
		expect(embedLabel({ ...base, kind: 'embed', text: '', link: '#Part' })).toBe('Part');
		expect(embedLabel({ ...base, kind: 'embed', text: '', link: 'Note' })).toBe('Note');
	});
	it('says what is missing', () => {
		expect(brokenLabel({ ...base, kind: 'broken', text: '', link: 'Gone', missing: 'note' })).toBe('No such note: Gone');
		expect(brokenLabel({ ...base, kind: 'broken', text: '', link: 'A#H', missing: 'heading' })).toBe('No such heading: A > H');
		expect(brokenLabel({ ...base, kind: 'broken', text: '', link: 'A#^b', missing: 'block' })).toBe('No such block: A > ^b');
		expect(brokenLabel({ ...base, kind: 'cycle', text: '', link: 'Loop' })).toBe('Embeds itself: Loop');
	});
});
