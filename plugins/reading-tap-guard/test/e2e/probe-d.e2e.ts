// Probe D: which real key path reaches the focused select in the settings window.
import { $, browser } from '@wdio/globals';
import { pluginId } from './load';

const ROW = 'Double tap interval';
const entries: string[] = [];
const log = (step: string, data: unknown): void => {
	entries.push(`${browser.getObsidianVersion()} ${step} ${JSON.stringify(data)}`);
};
type Host = { plugins: { plugins: Record<string, { pro: { signOut(): void } }> }; setting: { open(): void; close(): void; openTabById(id: string): void } };

const listen = () =>
	browser.execute((tag: string) => {
		const w = window as unknown as { __ev?: string[] };
		if (w.__ev) return 'had';
		w.__ev = [];
		for (const t of ['keydown', 'keyup', 'change', 'input', 'focusin', 'focusout']) {
			document.addEventListener(t, (e) => { const el = e.target as HTMLElement; w.__ev!.push(`${tag}:${t}:${el.tagName ?? 'win'}:${(e as KeyboardEvent).key ?? ''}`); }, true);
		}
		return 'new';
	}, 'x');

const read = () =>
	browser.execute((name: string) => {
		const w = window as unknown as { __ev?: string[]; opener?: Window | null };
		const row = [...document.querySelectorAll('.setting-item')].find((r) => r.querySelector('.setting-item-name')?.textContent === name);
		const sel = row?.querySelector('select');
		const a = document.activeElement as HTMLElement | null;
		let mainNotices = -1;
		try { mainNotices = (w.opener?.document.querySelectorAll('.notice').length ?? -2); } catch { mainNotices = -3; }
		return {
			ev: (w.__ev ?? []).splice(0),
			hasFocus: document.hasFocus(),
			active: a?.tagName ?? null,
			value: sel?.value ?? null,
			notices: document.querySelectorAll('.notice').length,
			mainNotices,
			appNotices: (window as unknown as { activeDocument?: Document }).activeDocument?.querySelectorAll('.notice').length ?? -1,
		};
	}, ROW);

const focusSel = () =>
	browser.execute((name: string) => {
		const row = [...document.querySelectorAll('.setting-item')].find((r) => r.querySelector('.setting-item-name')?.textContent === name)!;
		const sel = row.querySelector('select')!;
		sel.focus();
		document.querySelectorAll('[data-probe]').forEach((e) => e.removeAttribute('data-probe'));
		sel.setAttribute('data-probe', '1');
		return document.activeElement === sel;
	}, ROW);

const safe = async <T>(f: () => Promise<T>): Promise<T | string> => {
	try { return await f(); } catch (e) { return `ERR ${String((e as Error)?.message ?? e).slice(0, 200)}`; }
};

describe('probe D keys', function () {
	it('logs where real keys go', async function () {
		const main = await browser.getWindowHandle();
		await browser.executeObsidian(({ app }, id) => {
			const h = app as unknown as Host;
			h.plugins.plugins[id]!.pro.signOut();
			h.setting.open();
			h.setting.openTabById(id);
		}, pluginId);
		await browser.waitUntil(async () => browser.executeObsidian((_o, name) => [...activeDocument.querySelectorAll('.setting-item-name')].some((e) => e.textContent === name), ROW), { timeout: 10000 });
		await browser.pause(500);
		log('main-listen', await listen());
		let found = '';
		for (const h of await browser.getWindowHandles()) {
			await browser.switchToWindow(h);
			if (await browser.execute((name: string) => [...document.querySelectorAll('.setting-item-name')].some((e) => e.textContent === name), ROW)) { found = h; break; }
		}
		log('handles', { main: main.slice(-6), found: found.slice(-6) });
		log('set-listen', await listen());
		log('D1-focus', await focusSel());
		log('D1-before', await read());
		await browser.keys(['ArrowDown']);
		await browser.pause(800);
		log('D1-after', await read());
		log('D2-focus', await focusSel());
		await browser.keys(['Alt', 'ArrowDown']);
		await browser.keys(['Alt']);
		await browser.pause(300);
		log('D2-altdown', await read());
		await browser.keys(['ArrowDown']);
		await browser.keys(['Enter']);
		await browser.pause(800);
		log('D2-after', await read());
		log('D3-focus', await focusSel());
		log('D3-addValue', await safe(async () => { await $('select[data-probe="1"]').addValue('3'); return 'ok'; }));
		await browser.pause(800);
		log('D3-after', await read());
		log('D4-focus', await focusSel());
		const cdp = browser as unknown as { sendCommandAndGetResult(c: string, p: object): Promise<unknown> };
		log('D4-cdp', await safe(async () => {
			await cdp.sendCommandAndGetResult('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 });
			await cdp.sendCommandAndGetResult('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 });
			return 'ok';
		}));
		await browser.pause(800);
		log('D4-after', await read());
		await browser.switchToWindow(main);
		log('main-after', await read());
		throw new Error(`PROBE-DUMP ${JSON.stringify(entries)}`);
	});
});
