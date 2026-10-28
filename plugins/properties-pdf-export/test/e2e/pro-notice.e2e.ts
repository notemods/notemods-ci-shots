import { browser, expect } from '@wdio/globals';
import { pluginId } from './load';

// A free user who edits Folder layouts gets the shared Pro notice with the "Sponsor on GitHub" button. Nothing is
// saved and the field draws the saved rules again (none here). A Pro user saves the rules.
const LEAD = 'Folder layouts need Pro.';
type Manager = { opts: { http: unknown }; refreshNow(): Promise<void>; signOut(): void; isPro(): boolean };
type Host = { plugins: { plugins: Record<string, { pro: Manager | null; settings: { folderLayouts: string }; saveSettings(): Promise<void>; loadData(): Promise<unknown> }> } };

async function setPro(on: boolean): Promise<boolean> {
	return browser.executeObsidian(async ({ app }, id, enabled) => {
		const p = (app as unknown as Host).plugins.plugins[id]!;
		const pro = p.pro!;
		p.settings.folderLayouts = '';
		await p.saveSettings();
		if (!enabled) { pro.signOut(); return pro.isPro(); }
		// Synthetic token and HTTP answer. No network request.
		pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
		app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
		await pro.refreshNow();
		return pro.isPro();
	}, pluginId, on);
}

async function openTab(): Promise<void> {
	await browser.executeObsidian(({ app }, id) => {
		activeWindow.document.querySelectorAll('.notice').forEach((n) => n.remove());
		const setting = (app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting;
		setting.open();
		setting.openTabById(id);
	}, pluginId);
	await browser.waitUntil(async () => (await field(null)).found, { timeout: 10000, timeoutMsg: 'The settings tab did not show Folder layouts.' });
}

/** Finds the Folder layouts field. A string types that text into it (input and change events, as the user does). */
async function field(text: string | null): Promise<{ found: boolean; value: string; disabled: boolean }> {
	return browser.executeObsidian((_, value) => {
		const root = activeWindow.document.querySelector('.vertical-tab-content') ?? activeWindow.document.body;
		const nameEl = [...root.querySelectorAll<HTMLElement>('.setting-item-name')].find((el) => el.textContent?.trim() === 'Folder layouts');
		const area = nameEl?.closest('.setting-item')?.querySelector<HTMLTextAreaElement>('textarea');
		if (!area) return { found: false, value: '', disabled: false };
		if (value !== null) {
			area.focus();
			area.value = value;
			area.dispatchEvent(new Event('input', { bubbles: true }));
			area.dispatchEvent(new Event('change', { bubbles: true }));
		}
		return { found: true, value: area.value, disabled: area.disabled };
	}, text);
}

async function stored(): Promise<{ memory: string; disk: string }> {
	return browser.executeObsidian(async ({ app }, id) => {
		const p = (app as unknown as Host).plugins.plugins[id]!;
		return { memory: p.settings.folderLayouts, disk: JSON.stringify((await p.loadData()) ?? {}) };
	}, pluginId);
}

const notices = () => browser.executeObsidian(() => [...activeWindow.document.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', sponsor: n.querySelectorAll('.pf-pro-notice-sponsor').length })));

describe('Folder layouts Pro notice', function () {
	afterEach(async () => {
		await browser.executeObsidian(({ app }) => { (app as unknown as { setting: { close(): void } }).setting.close(); });
		await setPro(false);
	});

	it('a free user who edits Folder layouts gets the Pro notice with a Sponsor button, the field stays empty and nothing is saved', async () => {
		expect(await setPro(false)).toBe(false);
		const before = await stored();
		await openTab();
		expect((await field(null)).disabled).toBe(false);
		await field('Reports = compact');
		await browser.waitUntil(async () => (await notices()).some((n) => n.text.includes(LEAD) && n.sponsor === 1), { timeout: 5000, timeoutMsg: `No Pro notice after the edit: ${JSON.stringify(await notices())}` });
		await browser.waitUntil(async () => (await field(null)).value === '', { timeout: 5000, timeoutMsg: 'The Folder layouts field did not go back to empty.' });
		expect(await stored()).toEqual(before);
	});

	it('a Pro user who edits Folder layouts saves the rules, with no Pro notice', async () => {
		expect(await setPro(true)).toBe(true);
		await openTab();
		await field('Reports = compact');
		await browser.waitUntil(async () => (await stored()).memory === 'Reports = compact', { timeout: 5000, timeoutMsg: 'A Pro user could not save Folder layouts.' });
		expect((await notices()).filter((n) => n.sponsor > 0)).toEqual([]);
	});
});
