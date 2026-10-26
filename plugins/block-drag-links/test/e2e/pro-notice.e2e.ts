import { browser, expect } from '@wdio/globals';
import { pluginId } from './load';
import type Plugin from '../../src/main';

type Notices = { text: string; buttons: number }[];

const NEXT = 'Sponsor on GitHub, then sign in from the plugin settings.';
const MULTI = 'Drag all blocks of a selection is a Pro feature.';
const READABLE = 'Readable block IDs are a Pro feature.';

async function openTab(): Promise<void> {
	await browser.executeObsidian(({ app }, id) => {
		const setting = (app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting;
		setting.open();
		setting.openTabById(id);
	}, pluginId);
	await browser.waitUntil(async () => (await toggleState('Readable block IDs')) !== null, { timeout: 5000, timeoutMsg: 'The settings tab did not show the Pro toggles.' });
}

async function closeTab(): Promise<void> {
	await browser.executeObsidian(({ app }) => {
		(app as unknown as { setting: { close(): void } }).setting.close();
		document.querySelectorAll('.notice').forEach((n) => n.remove());
	});
}

/** On, off, or null when the row is not drawn. Also null when the toggle is disabled. */
async function toggleState(name: string): Promise<{ on: boolean; disabled: boolean } | null> {
	return browser.executeObsidian((_ctx, label) => {
		const row = [...document.querySelectorAll('.modal .setting-item')].find((r) => r.querySelector('.setting-item-name')?.textContent === label);
		const box = row?.querySelector('.checkbox-container');
		if (!row || !box) return null;
		return { on: box.classList.contains('is-enabled'), disabled: box.classList.contains('is-disabled') || row.classList.contains('is-disabled') };
	}, name);
}

async function clickToggle(name: string): Promise<void> {
	await browser.executeObsidian((_ctx, label) => {
		const row = [...document.querySelectorAll('.modal .setting-item')].find((r) => r.querySelector('.setting-item-name')?.textContent === label);
		const box = row?.querySelector<HTMLElement>('.checkbox-container');
		if (!box) throw new Error(`no toggle ${label}`);
		box.click();
	}, name);
}

const notices = (): Promise<Notices> => browser.executeObsidian(() => [...document.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', buttons: n.querySelectorAll('.pf-pro-notice-sponsor').length })));

async function stored(): Promise<{ memory: { multiBlock: boolean; readableIds: boolean }; disk: unknown }> {
	return browser.executeObsidian(async ({ app }, id) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, Plugin> } }).plugins.plugins[id]!;
		return { memory: { ...p.settings }, disk: (await p.loadData()) as unknown };
	}, pluginId);
}

describe(`${pluginId} Pro notice`, function () {
	afterEach(async function () {
		await closeTab();
	});

	it('a free user who selects a Pro toggle gets a Pro notice with a Sponsor button and the setting stays', async function () {
		await browser.executeObsidian(({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, Plugin> } }).plugins.plugins[id]!;
			p.pro?.signOut();
			document.querySelectorAll('.notice').forEach((n) => n.remove());
		}, pluginId);
		const before = await stored();
		await openTab();
		const readable = await toggleState('Readable block IDs');
		const multi = await toggleState('Drag all blocks of a selection');
		expect(readable).toEqual({ on: before.memory.readableIds, disabled: false });
		expect(multi).toEqual({ on: before.memory.multiBlock, disabled: false });

		await clickToggle('Readable block IDs');
		await browser.waitUntil(async () => (await notices()).some((n) => n.text.includes(READABLE)), { timeout: 5000, timeoutMsg: 'No Pro notice after Readable block IDs.' });
		const one = (await notices()).find((n) => n.text.includes(READABLE))!;
		expect(one.text).toContain(`${READABLE} ${NEXT}`);
		expect(one.buttons).toBe(1);
		// The tab draws again with the stored value.
		await browser.waitUntil(async () => (await toggleState('Readable block IDs'))?.on === before.memory.readableIds, { timeout: 5000, timeoutMsg: 'The Readable block IDs toggle did not show the stored value again.' });

		await clickToggle('Drag all blocks of a selection');
		await browser.waitUntil(async () => (await notices()).some((n) => n.text.includes(MULTI)), { timeout: 5000, timeoutMsg: 'No Pro notice after Drag all blocks of a selection.' });
		const two = (await notices()).find((n) => n.text.includes(MULTI))!;
		expect(two.text).toContain(`${MULTI} ${NEXT}`);
		expect(two.buttons).toBe(1);
		await browser.waitUntil(async () => (await toggleState('Drag all blocks of a selection'))?.on === before.memory.multiBlock, { timeout: 5000, timeoutMsg: 'The Drag all blocks toggle did not show the stored value again.' });

		// The Pro action did not run: no value changed in memory or on disk.
		expect(await stored()).toEqual(before);
	});

	it('a Pro user who selects a Pro toggle changes the setting', async function () {
		await browser.executeObsidian(async ({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, Plugin> } }).plugins.plugins[id]!;
			if (!p.pro) throw new Error('Sponsors manager missing');
			const manager = p.pro as unknown as { opts: { http: unknown }; refreshNow(): Promise<unknown>; isPro(): boolean };
			manager.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'fixture-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
			app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
			await manager.refreshNow();
			if (!manager.isPro()) throw new Error('The simulated Sponsors check did not turn Pro on.');
			p.settings.readableIds = false;
			await p.saveSettings();
			document.querySelectorAll('.notice').forEach((n) => n.remove());
		}, pluginId);
		try {
			await openTab();
			expect(await toggleState('Readable block IDs')).toEqual({ on: false, disabled: false });
			await clickToggle('Readable block IDs');
			await browser.waitUntil(async () => (await stored()).memory.readableIds, { timeout: 5000, timeoutMsg: 'A Pro user could not turn on Readable block IDs.' });
			const after = await stored();
			expect((after.disk as { readableIds?: boolean } | null)?.readableIds).toBe(true);
			expect(await toggleState('Readable block IDs')).toEqual({ on: true, disabled: false });
			expect((await notices()).some((n) => n.text.includes('Pro feature'))).toBe(false);
		} finally {
			await browser.executeObsidian(async ({ app }, id) => {
				const p = (app as unknown as { plugins: { plugins: Record<string, Plugin> } }).plugins.plugins[id]!;
				p.settings.readableIds = false;
				await p.saveSettings();
				p.pro?.signOut();
			}, pluginId);
		}
	});
});
