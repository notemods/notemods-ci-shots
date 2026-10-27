import { browser, expect } from '@wdio/globals';
import type { SponsorsManager } from '../../src/license/index';
import { pluginId } from './load';

// A free user can select Focus scope (Pro). The select shows the shared Pro notice with the "Sponsor on GitHub" button.
// The dropdown shows Paragraph again and nothing is saved. A Pro user selects Section and the choice is saved.
type Plugin = { pro: SponsorsManager; settings: Record<string, unknown>; loadData(): Promise<unknown>; saveSettings(): Promise<void> };
type Host = { plugins: { plugins: Record<string, Plugin> }; setting: { open(): void; close(): void; openTabById(id: string): void } };
const SCOPE = 'Focus scope (Pro)';

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

async function openTab(): Promise<void> {
	await browser.executeObsidian(({ app }, id) => {
		activeDocument.querySelectorAll('.notice').forEach((n) => n.remove());
		const s = (app as unknown as Host).setting; s.open(); s.openTabById(id);
	}, pluginId);
	await browser.waitUntil(async () => browser.executeObsidian((_, name) => [...activeDocument.querySelectorAll('.setting-item-name')].some((e) => e.textContent === name), SCOPE), { timeout: 10000, timeoutMsg: 'The settings tab drew no Focus scope row' });
}

/** Selects a scope in the Focus scope dropdown, then reads the dropdown, the notices and the saved data. */
async function select(value: string | null) {
	return browser.executeObsidian(async ({ app }, value, id, name) => {
		const sel = () => [...activeDocument.querySelectorAll('.setting-item')].find((r) => r.querySelector('.setting-item-name')?.textContent === name)?.querySelector('select') as HTMLSelectElement | null;
		if (value) { const s = sel()!; s.focus(); s.value = value; s.dispatchEvent(new Event('change', { bubbles: true })); }
		await new Promise((r) => setTimeout(r, 400));
		const p = (app as unknown as Host).plugins.plugins[id]!;
		return {
			value: sel()?.value ?? null,
			disabled: sel()?.disabled ?? null,
			notices: [...activeDocument.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', sponsor: n.querySelectorAll('.pf-pro-notice-sponsor').length })),
			settings: JSON.stringify(p.settings),
			saved: JSON.stringify((await p.loadData()) ?? {}),
		};
	}, value, pluginId, SCOPE);
}

describe('Pro settings', function () {
	let original = '';
	before(async () => {
		original = await browser.executeObsidian(({ app }, id) => JSON.stringify((app as unknown as Host).plugins.plugins[id]!.settings), pluginId);
	});
	afterEach(async () => {
		await browser.executeObsidian(async ({ app }, id, original) => {
			(app as unknown as Host).setting.close();
			const p = (app as unknown as Host).plugins.plugins[id]!;
			p.settings = JSON.parse(original) as Record<string, unknown>;
			await p.saveSettings();
		}, pluginId, original);
		await setPro(false);
	});

	it('a free user who selects Section in Focus scope gets a Pro notice with a Sponsor button, the dropdown shows Paragraph and nothing is saved', async () => {
		expect(await setPro(false)).toBe(false);
		await openTab();
		const before = await select(null);
		expect(before.disabled).toBe(false);
		const after = await select('section');
		if (!after.notices.some((n) => n.text.includes('Section spelling focus needs Pro.') && n.sponsor === 1)) throw new Error(`No Pro notice after Focus scope: ${JSON.stringify(after.notices)}`);
		expect(after.value).toBe('paragraph');
		expect(after.settings).toBe(before.settings);
		expect(after.saved).toBe(before.saved);
	});

	it('a Pro user who selects Section in Focus scope saves it, with no Sponsor notice', async () => {
		expect(await setPro(true)).toBe(true);
		await openTab();
		const after = await select('section');
		expect(after.value).toBe('section');
		expect(JSON.parse(after.saved).scope).toBe('section');
		expect(after.notices.filter((n) => n.sponsor > 0)).toEqual([]);
	});
});
