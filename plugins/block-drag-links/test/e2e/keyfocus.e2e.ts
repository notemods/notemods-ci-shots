import { $, browser, expect } from '@wdio/globals';
import { pluginId } from './load';

/** The Pro row that a free user changes with the keyboard, and the key that changes its control. */
const ROW = 'Readable block IDs';
const KEY = '\uE00D';

interface Focus { row: string | null; tag: string }

/** The settings row and the tag of the element that has the keyboard focus. */
const where = (): Promise<Focus> =>
	browser.executeObsidian(() => {
		const active = document.activeElement as HTMLElement | null;
		const row = active?.closest('.setting-item');
		return { row: row?.querySelector('.setting-item-name')?.textContent ?? null, tag: active?.tagName.toLowerCase() ?? '' };
	});

const notices = (): Promise<number> => browser.executeObsidian(() => document.querySelectorAll('.notice').length);

describe(`${pluginId} keyboard focus after a refused Pro setting`, function () {
	after(async function () {
		await browser.executeObsidian(({ app }) => {
			(app as unknown as { setting: { close(): void } }).setting.close();
			document.querySelectorAll('.notice').forEach((n) => n.remove());
		});
	});

	it(`a free user who changes "${ROW}" with the keyboard keeps the focus on that control`, async function () {
		// A free user: sign out of each Pro manager of the plugin, then open the settings tab of the plugin.
		await browser.executeObsidian(({ app }, id) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, Record<string, unknown>> } }).plugins.plugins[id]!;
			for (const value of Object.values(plugin)) {
				const signOut = (value as { signOut?: unknown } | null)?.signOut;
				if (typeof signOut === 'function') (signOut as () => void).call(value);
			}
			const setting = (app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting;
			setting.open();
			setting.openTabById(id);
		}, pluginId);
		await browser.waitUntil(
			async () =>
				browser.executeObsidian(({ app }, name) => {
					const root = (app as unknown as { setting: { activeTab?: { containerEl: HTMLElement } } }).setting.activeTab?.containerEl;
					return !!root && [...root.querySelectorAll('.setting-item')].some((r) => r.querySelector('.setting-item-name')?.textContent === name);
				}, ROW),
			{ timeout: 10000, timeoutMsg: `The settings tab has no row "${ROW}".` },
		);
		// Reach the control with real input only: a script focus() has no effect in this test window. A real click on
		// the name of the row sets the start point of the Tab order, then the Tab key moves the focus to the control.
		// The tab can draw again after the sign out, so wait, then find the row by its name with XPath (no stored element).
		await browser.pause(1000);
		const info = await $(`//div[contains(@class,"setting-item-name") and normalize-space()="${ROW}"]/parent::div`);
		await info.scrollIntoView({ block: 'center' });
		await info.click();
		let at = await where();
		const path: string[] = [`${at.tag}:${at.row ?? ''}`];
		for (let i = 0; i < 40 && at.row !== ROW; i++) {
			await browser.keys(['Tab']);
			at = await where();
			if (i < 12) path.push(`${at.tag}:${at.row ?? ''}`);
		}
		expect(`${at.row} after Tab (${path.join(' > ')})`).toBe(`${ROW} after Tab (${path.join(' > ')})`);
		const before = at;
		await browser.executeObsidian(() => document.querySelectorAll('.notice').forEach((n) => n.remove()));
		// Change the control with the key. The plugin refuses the change and shows the Pro notice.
		await browser.keys([KEY]);
		await browser.waitUntil(async () => (await notices()) > 0, { timeout: 5000, timeoutMsg: `No Pro notice after the key on "${ROW}" (focus was ${before.tag}).` });
		// Obsidian draws the tab again. The focus must stay on the same control.
		await browser.pause(800);
		expect(await where()).toEqual({ row: ROW, tag: before.tag });
	});
});
