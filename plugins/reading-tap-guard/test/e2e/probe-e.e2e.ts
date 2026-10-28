// Probe E: why Element Send Keys did not change the select in focus-keep.e2e.ts.
import { $, browser } from '@wdio/globals';
import { pluginId } from './load';

const ROW = 'Double tap interval';
const entries: string[] = [];
const log = (step: string, data: unknown): void => { entries.push(`${browser.getObsidianVersion()} ${step} ${JSON.stringify(data)}`); };
type Host = { plugins: { plugins: Record<string, Record<string, unknown>> }; setting: { open(): void; close(): void; openTabById(id: string): void } };

const read = () =>
	browser.execute((name: string) => {
		const w = window as unknown as { __ev?: string[] };
		if (!w.__ev) {
			w.__ev = [];
			for (const t of ['keydown', 'keypress', 'keyup', 'change', 'input', 'focusin', 'focusout']) document.addEventListener(t, (e) => { const el = e.target as HTMLElement; w.__ev!.push(`${t}:${el.tagName ?? 'win'}:${(e as KeyboardEvent).key ?? ''}`); }, true);
		}
		const row = [...document.querySelectorAll('.setting-item')].find((r) => r.querySelector('.setting-item-name')?.textContent === name);
		const sel = row?.querySelector('select');
		const a = document.activeElement as HTMLElement | null;
		return { ev: w.__ev.splice(0), hasFocus: document.hasFocus(), active: a ? `${a.tagName}.${String(a.className).slice(0, 30)}` : null, activeRow: a?.closest('.setting-item')?.querySelector('.setting-item-name')?.textContent ?? null, value: sel?.value ?? null, opts: sel ? [...sel.options].map((o) => o.text.slice(0, 6)) : null, notices: document.querySelectorAll('.notice').length };
	}, ROW);

const mark = () =>
	browser.execute((name: string) => {
		const row = [...document.querySelectorAll('.setting-item')].find((r) => r.querySelector('.setting-item-name')?.textContent === name)!;
		const c = row.querySelector<HTMLElement>('select')!;
		c.focus();
		document.querySelectorAll('[data-focus-test]').forEach((e) => e.removeAttribute('data-focus-test'));
		c.setAttribute('data-focus-test', '1');
		return document.activeElement === c;
	}, ROW);

const safe = async <T>(f: () => Promise<T>): Promise<T | string> => { try { return await f(); } catch (e) { return `ERR ${String((e as Error)?.message ?? e).slice(0, 200)}`; } };

describe('probe E send keys', function () {
	it('logs each key path', async function () {
		await browser.executeObsidian(({ app }, id) => {
			const plugin = (app as unknown as Host).plugins.plugins[id]!;
			for (const value of Object.values(plugin)) { const s = (value as { signOut?: unknown } | null)?.signOut; if (typeof s === 'function') (s as () => void).call(value); }
			const st = (app as unknown as Host).setting; st.open(); st.openTabById(id);
		}, pluginId);
		await browser.waitUntil(async () => browser.executeObsidian((_o, name) => [...activeDocument.querySelectorAll('.setting-item-name')].some((e) => e.textContent === name), ROW), { timeout: 10000 });
		await browser.pause(500);
		for (const h of await browser.getWindowHandles()) {
			await browser.switchToWindow(h);
			if (await browser.execute((name: string) => [...document.querySelectorAll('.setting-item-name')].some((e) => e.textContent === name), ROW)) break;
		}
		log('E0', await read());
		for (const [step, how, key] of [['E1', 'send', '4'], ['E2', 'send', '3'], ['E3', 'keys', '3'], ['E4', 'send', '2']] as const) {
			log(`${step}-mark`, await mark());
			log(`${step}-before`, await read());
			log(`${step}-do`, await safe(async () => { if (how === 'send') await $('[data-focus-test="1"]').addValue(key); else await browser.keys([key]); return 'ok'; }));
			await browser.pause(800);
			log(`${step}-after`, await read());
		}
		throw new Error(`PROBE-DUMP ${JSON.stringify(entries)}`);
	});
});
