import { browser, expect } from '@wdio/globals';
import { pluginId } from './load';

// A free user can select a Pro option in the settings tab. The plugin shows the shared Pro notice with a
// "Sponsor on GitHub" button and does not save the option. A Pro user selects the same option and it is saved.
const LEAD = 'Count folded lines is a Pro option.';
const NAME = 'Count folded lines';

interface Row {
	found: boolean;
	disabled: boolean;
	on: boolean;
}

/** The toggle row of the setting with this name in the open settings tab. */
async function row(name: string): Promise<Row> {
	return browser.execute((n) => {
		const item = [...document.querySelectorAll<HTMLElement>('.modal.mod-settings .setting-item')].find((el) => el.querySelector('.setting-item-name')?.textContent === n);
		const box = item?.querySelector<HTMLElement>('.checkbox-container');
		if (!item || !box) return { found: false, disabled: false, on: false };
		const input = box.querySelector('input');
		return { found: true, disabled: item.classList.contains('is-disabled') || box.classList.contains('is-disabled') || !!input?.disabled, on: box.classList.contains('is-enabled') };
	}, name);
}

async function clickToggle(name: string): Promise<void> {
	await browser.execute((n) => {
		const item = [...document.querySelectorAll<HTMLElement>('.modal.mod-settings .setting-item')].find((el) => el.querySelector('.setting-item-name')?.textContent === n);
		item?.querySelector<HTMLElement>('.checkbox-container')?.click();
	}, name);
}

const notices = () => browser.executeObsidian(() => [...document.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', buttons: n.querySelectorAll('.pf-pro-notice-sponsor').length })));

async function saved(): Promise<{ live: boolean; disk: boolean }> {
	return browser.executeObsidian(async ({ app }, id) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, { settings: { countFolded: boolean }; loadData(): Promise<{ countFolded?: boolean } | null> }> } }).plugins.plugins[id]!;
		return { live: p.settings.countFolded, disk: (await p.loadData())?.countFolded === true };
	}, pluginId);
}

async function openTab(): Promise<void> {
	await browser.executeObsidian(({ app }, id) => {
		const s = (app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting;
		s.open();
		s.openTabById(id);
	}, pluginId);
	await browser.waitUntil(async () => (await row(NAME)).found, { timeout: 5000, timeoutMsg: 'The Count folded lines row is not in the settings tab.' });
}

async function reset(): Promise<void> {
	await browser.executeObsidian(async ({ app }, id) => {
		(app as unknown as { setting: { close(): void } }).setting.close();
		const p = (app as unknown as { plugins: { plugins: Record<string, { settings: { countFolded: boolean }; saveSettings(): Promise<void>; applySettings(): void; pro: { signOut(): void } | null }> } }).plugins.plugins[id]!;
		p.pro?.signOut();
		p.settings.countFolded = false;
		await p.saveSettings();
		p.applySettings();
		document.querySelectorAll('.notice').forEach((n) => n.remove());
	}, pluginId);
}

describe('Pro options in the settings tab', () => {
	before(reset);
	afterEach(reset);

	it('a free user who selects Count folded lines gets a Pro notice with a Sponsor button, and the option stays off', async () => {
		await openTab();
		const before = await row(NAME);
		expect(before).toEqual({ found: true, disabled: false, on: false });
		await clickToggle(NAME);
		await browser.waitUntil(async () => (await notices()).some((n) => n.text.includes(LEAD)), { timeout: 5000, timeoutMsg: 'No Pro notice after the free user selected Count folded lines.' });
		const notice = (await notices()).find((n) => n.text.includes(LEAD))!;
		expect(notice.text).toContain(`${LEAD} Sponsor on GitHub, then sign in from the plugin settings.`);
		expect(notice.buttons).toBe(1);
		expect(await saved()).toEqual({ live: false, disk: false });
		// The toggle shows the saved value again.
		await browser.waitUntil(async () => !(await row(NAME)).on, { timeout: 3000, timeoutMsg: 'The toggle stays on after the Pro notice.' });
	});

	it('a Pro user who selects Count folded lines saves the option, with no Pro notice', async () => {
		await browser.executeObsidian(async ({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, { pro: unknown }> } }).plugins.plugins[id]!;
			const manager = p.pro as { opts: { http: unknown }; refreshNow(): Promise<unknown>; isPro(): boolean };
			manager.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'fixture-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
			app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
			await manager.refreshNow();
			if (!manager.isPro()) throw new Error('The simulated Sponsors check did not turn Pro on.');
		}, pluginId);
		await openTab();
		expect((await row(NAME)).disabled).toBe(false);
		await clickToggle(NAME);
		await browser.waitUntil(async () => (await saved()).disk, { timeout: 5000, timeoutMsg: 'A Pro user could not save Count folded lines.' });
		expect(await saved()).toEqual({ live: true, disk: true });
		expect((await row(NAME)).on).toBe(true);
		expect((await notices()).some((n) => n.text.includes(LEAD))).toBe(false);
	});
});
