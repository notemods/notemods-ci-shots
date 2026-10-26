import { afterEach, describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import NoteWordCommentsPlugin from '../src/main';
import { PRO_UI, SPONSORS, bindPro, isPro, onProChange, resetPro } from '../src/pro';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
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
	};
}

describe('settings', () => {
	it('loads with default settings against an in-memory vault', async () => {
		const app = App.createConfigured__({ files: { 'notes/a.md': '# Hello world' } });
		const plugin = new NoteWordCommentsPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(isPro()).toBe(false);
	});

	it('repairs bad saved settings', () => {
		expect(normalizeSettings({ author: 5 as never, authorLabels: 'yes' as never })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ author: '   ' }).author).toBe('Writer');
		expect(normalizeSettings({ author: ' Lee ', authorLabels: false })).toEqual({ author: 'Lee', authorLabels: false });
		expect(normalizeSettings({ author: 'x'.repeat(200) }).author).toHaveLength(80);
	});

	it('uses labels only when Pro is on', () => {
		const app = App.createConfigured__({ files: {} });
		const plugin = new NoteWordCommentsPlugin(app as never, manifest as never);
		plugin.settings = { author: 'Lee', authorLabels: true };
		expect(plugin.planOptions()).toEqual({ author: 'Lee', pro: false, labels: false });
		const m = fakeManager(true);
		bindPro(m as never);
		expect(plugin.planOptions()).toEqual({ author: 'Lee', pro: true, labels: true });
		plugin.settings.authorLabels = false;
		expect(plugin.planOptions().labels).toBe(false);
	});
});

describe('pro facade', () => {
	it('uses the GitHub Sponsors values of the reference product', () => {
		expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', sponsorLogin: 'theluckystrike', minMonthlyUsd: 5, oneTimeUsd: 15, scope: 'read:user' });
		expect(PRO_UI.priceText).toContain('$5 a month, or $15 once');
	});

	it('follows the manager and tells listeners', () => {
		const m = fakeManager(false);
		bindPro(m as never);
		let calls = 0;
		const off = onProChange(() => calls++);
		m.set(true);
		expect(isPro()).toBe(true);
		expect(calls).toBe(1);
		off();
		m.set(false);
		expect(calls).toBe(1);
		expect(isPro()).toBe(false);
	});
});
