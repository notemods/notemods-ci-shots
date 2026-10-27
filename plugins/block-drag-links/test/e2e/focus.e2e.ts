import { browser, expect } from '@wdio/globals';
import { pluginId } from './load';

/** The Pro row that the test changes as a free user, and how its control changes. */
const ROW = 'Readable block IDs';

interface Focus { row: string | null; fresh: boolean; tag: string }

describe(`${pluginId} focus after a refused Pro setting`, function () {
	after(async function () {
		await browser.executeObsidian(({ app }) => {
			(app as unknown as { setting: { close(): void } }).setting.close();
			document.querySelectorAll('.notice').forEach((n) => n.remove());
		});
	});

	it(`a free user who changes "${ROW}" keeps the focus on the same control`, async function () {
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
			async () => browser.executeObsidian(({ app }, name) => {
				const root = (app as unknown as { setting: { activeTab?: { containerEl: HTMLElement } } }).setting.activeTab?.containerEl;
				return !!root && [...root.querySelectorAll('.setting-item')].some((r) => r.querySelector('.setting-item-name')?.textContent === name);
			}, ROW),
			{ timeout: 10000, timeoutMsg: `The settings tab has no row "${ROW}".` },
		);
		// Put the focus on the control and change it, as a keyboard user does. The plugin refuses the change.
		const kind = await browser.executeObsidian(({ app }, name) => {
			const root = (app as unknown as { setting: { activeTab: { containerEl: HTMLElement } } }).setting.activeTab.containerEl;
			const row = [...root.querySelectorAll('.setting-item')].find((r) => r.querySelector('.setting-item-name')?.textContent === name)!;
			const control = row.querySelector<HTMLElement>('.checkbox-container, select, textarea, input')!;
			control.setAttribute('data-focus-test', 'old');
			control.focus();
			if (control.classList.contains('checkbox-container')) {
				control.click();
			} else if (control instanceof HTMLSelectElement) {
				const other = [...control.options].find((o) => o.value !== control.value)!;
				control.value = other.value;
				control.dispatchEvent(new Event('change'));
			} else {
				const field = control as HTMLInputElement | HTMLTextAreaElement;
				field.value = `${field.value}7`;
				field.dispatchEvent(new Event('input'));
			}
			return control.tagName.toLowerCase();
		}, ROW);
		const focus = (): Promise<Focus> => browser.executeObsidian(() => {
			const active = document.activeElement as HTMLElement | null;
			const row = active?.closest('.setting-item');
			return { row: row?.querySelector('.setting-item-name')?.textContent ?? null, fresh: !!active && active.getAttribute('data-focus-test') !== 'old', tag: active?.tagName.toLowerCase() ?? '' };
		});
		let last: Focus = { row: null, fresh: false, tag: '' };
		await browser.waitUntil(
			async () => {
				last = await focus();
				return last.row === ROW && last.fresh;
			},
			{ timeout: 5000, interval: 100, timeoutMsg: `After the refused change, the focus did not go back to "${ROW}".` },
		).catch(() => undefined);
		// The focus is on the new control of the same row (Obsidian drew the row again), with the same kind of control.
		expect(last).toEqual({ row: ROW, fresh: true, tag: kind });
	});
});
