import { browser, expect } from '@wdio/globals';
import type { SponsorsManager } from '../../src/license/index';
import { pluginId } from './load';

// A free user can select the Pro controls of the import window. Each one shows the shared Pro notice with the
// "Sponsor on GitHub" button. No preset is saved, no comparison runs, and the subtree roots field stays empty.
// A Pro user types a subtree root and saves a preset as before.
type Plugin = { pro: SponsorsManager; settings: { presets: unknown[] }; modals: Set<{ close(): void; layout: { groupRoots: string[] } }>; loadData(): Promise<unknown>; saveSettings(): Promise<void> };
type Host = { plugins: { plugins: Record<string, Plugin> } };
const SOURCE = JSON.stringify({ docs: [{ _id: 'root', key: ['Study plan'], children: ['child'] }, { _id: 'child', parent: 'root', key: ['Practice'] }] });
const ROOTS = '//div[contains(@class,"setting-item")][.//div[contains(@class,"setting-item-name") and text()="Pro subtree roots"]]//input';

async function setPro(on: boolean): Promise<boolean> {
	return browser.executeObsidian(async ({ app }, enabled, id) => {
		const pro = (app as unknown as Host).plugins.plugins[id]!.pro;
		if (!enabled) { pro.signOut(); return pro.isPro(); }
		// Synthetic token store and HTTP answer. No network request or Keychain key.
		let token: string | null = 'gho_' + '0'.repeat(36);
		pro.opts.tokens.get = () => token; pro.opts.tokens.set = (v) => { token = v; }; pro.opts.tokens.clear = () => { token = null; };
		pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader', totalSponsorshipAmountAsSponsorInCents: 1500 }, user: { viewerIsSponsoring: true, sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
		await pro.refreshNow();
		return pro.isPro();
	}, on, pluginId);
}

async function openWindow(): Promise<void> {
	await browser.executeObsidian(() => { activeDocument.querySelectorAll('.notice').forEach((n) => n.remove()); });
	await browser.executeObsidianCommand(`${pluginId}:open-import`);
	const input = browser.$('textarea[aria-label="Source JSON"]');
	await input.waitForDisplayed({ timeout: 20000 });
	await input.setValue(SOURCE);
	await browser.$('button=Preview').click();
	await browser.waitUntil(async () => (await browser.$('.remnote-import-count').getText()) === '2 source Rems → 2 notes. 0 warnings.', { timeout: 20000, timeoutMsg: 'The preview did not show' });
}

async function state() {
	return browser.executeObsidian(async ({ app }, id) => {
		const p = (app as unknown as Host).plugins.plugins[id]!;
		const modal = [...p.modals][0];
		return {
			notices: [...activeDocument.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', sponsor: n.querySelectorAll('.pf-pro-notice-sponsor').length })),
			settings: JSON.stringify(p.settings),
			saved: JSON.stringify((await p.loadData()) ?? {}),
			roots: modal ? [...modal.layout.groupRoots] : null,
			preview: activeDocument.querySelector('.remnote-import-preview')?.textContent ?? '',
		};
	}, pluginId);
}

async function click(text: string): Promise<void> {
	await browser.executeObsidian((_, text) => {
		[...activeDocument.querySelectorAll('.remnote-import-modal button')].find((b) => b.textContent === text)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
	}, text);
	await browser.pause(300);
}

describe('Pro controls of the import window', function () {
	let original = '';
	before(async () => {
		original = await browser.executeObsidian(({ app }, id) => JSON.stringify((app as unknown as Host).plugins.plugins[id]!.settings), pluginId);
	});
	afterEach(async () => {
		await browser.executeObsidian(async ({ app }, id, original) => {
			const p = (app as unknown as Host).plugins.plugins[id]!;
			for (const modal of [...p.modals]) modal.close();
			Object.assign(p.settings, JSON.parse(original));
			await p.saveSettings();
		}, pluginId, original);
		await setPro(false);
	});

	it('a free user who selects Save preset, Pro change preview or types a subtree root gets a Pro notice with a Sponsor button, and nothing runs or saves', async () => {
		expect(await setPro(false)).toBe(false);
		await openWindow();
		const before = await state();
		await click('Save preset');
		const preset = await state();
		if (!preset.notices.some((n) => n.text.includes('Layout presets need Pro.') && n.sponsor === 1)) throw new Error(`No Pro notice after Save preset: ${JSON.stringify(preset.notices)}`);
		await click('Pro change preview');
		const changes = await state();
		if (!changes.notices.some((n) => n.text.includes('The change preview needs Pro.') && n.sponsor === 1)) throw new Error(`No Pro notice after Pro change preview: ${JSON.stringify(changes.notices)}`);
		await browser.$(ROOTS).click();
		await browser.keys('root');
		await browser.pause(300);
		const roots = await state();
		expect(roots.notices.filter((n) => n.text.includes('Subtree documents need Pro.') && n.sponsor === 1).length).toBe(1);
		expect(await browser.$(ROOTS).getValue()).toBe('');
		expect(roots.roots).toEqual([]);
		expect(roots.settings).toBe(before.settings);
		expect(roots.saved).toBe(before.saved);
		// The free preview and the Create notes button stay.
		expect(roots.preview).toBe(before.preview);
		expect(await browser.$('button=Create notes').isEnabled()).toBe(true);
	});

	it('a Pro user who types a subtree root keeps it and saves a preset, with no Sponsor notice', async () => {
		expect(await setPro(true)).toBe(true);
		await openWindow();
		await browser.$(ROOTS).click();
		await browser.keys('root');
		await browser.$('input[placeholder="Preset name"]').setValue('E2E layout');
		await click('Save preset');
		const after = await state();
		expect(await browser.$(ROOTS).getValue()).toBe('root');
		expect(after.roots).toEqual(['root']);
		expect(after.settings).toContain('E2E layout');
		expect(after.notices.filter((n) => n.sponsor > 0)).toEqual([]);
	});
});
