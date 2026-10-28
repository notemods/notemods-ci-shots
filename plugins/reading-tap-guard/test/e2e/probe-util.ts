// Focus probe helpers (s1028 FOCUS). Throwaway: these files never go to main.
import { $, browser } from '@wdio/globals';
import { pluginId } from './load';

export const ROW = 'Double tap interval';
type Host = { plugins: { plugins: Record<string, { pro: { signOut(): void } }> }; setting: { open(): void; close(): void; openTabById(id: string): void } };

export function log(step: string, data: unknown): void {
	console.log(`PROBE ${process.env.PROBE_NAME ?? ''} ${browser.getObsidianVersion()} ${step} ${JSON.stringify(data)}`);
}

/** Sign out, install focus listeners, open the settings tab and wait for the row. */
export async function openFree(): Promise<void> {
	await browser.executeObsidian(({ app }, id) => {
		const h = app as unknown as Host;
		h.plugins.plugins[id]!.pro.signOut();
		const w = window as unknown as { __pf?: string[] };
		if (!w.__pf) {
			w.__pf = [];
			const d = (e: Event) => { const t = e.target as HTMLElement | Window; w.__pf!.push(`${e.type}:${t instanceof HTMLElement ? t.tagName : 'window'}`); };
			document.addEventListener('focusin', d, true);
			document.addEventListener('focusout', d, true);
			window.addEventListener('focus', d);
			window.addEventListener('blur', d);
		}
		document.querySelectorAll('.notice').forEach((n) => n.remove());
		h.setting.open();
		h.setting.openTabById(id);
	}, pluginId);
	await browser.waitUntil(async () => browser.executeObsidian((_o, name) => [...document.querySelectorAll('.setting-item-name')].some((e) => e.textContent === name), ROW), { timeout: 10000 });
	await browser.pause(800);
}

/** The focus state of the window and of the select in the row. */
export async function state(): Promise<Record<string, unknown>> {
	return browser.executeObsidian((_o, name) => {
		const w = window as unknown as { __pf?: string[] };
		const row = [...document.querySelectorAll('.setting-item')].find((r) => r.querySelector('.setting-item-name')?.textContent === name);
		const sel = row?.querySelector('select') ?? null;
		const a = document.activeElement as HTMLElement | null;
		return {
			hasFocus: document.hasFocus(),
			vis: document.visibilityState,
			active: a ? `${a.tagName}.${String(a.className).split(' ').slice(0, 2).join('.')}` : null,
			activeRow: a?.closest('.setting-item')?.querySelector('.setting-item-name')?.textContent ?? null,
			selFocus: sel ? sel.matches(':focus') : null,
			value: sel?.value ?? null,
			events: (w.__pf ?? []).splice(0),
			notices: [...document.querySelectorAll('.notice')].map((n) => (n.textContent ?? '').slice(0, 50)),
		};
	}, ROW);
}

export async function selDiag(): Promise<Record<string, unknown>> {
	return browser.executeObsidian((_o, name) => {
		const row = [...document.querySelectorAll('.setting-item')].find((r) => r.querySelector('.setting-item-name')?.textContent === name);
		const sel = row?.querySelector('select') as HTMLSelectElement | null;
		if (!sel) return { sel: null };
		const cs = getComputedStyle(sel);
		return {
			rects: sel.getClientRects().length,
			inert: !!sel.closest('[inert]'),
			disabled: sel.disabled,
			tabIndex: sel.tabIndex,
			display: cs.display,
			visibility: cs.visibility,
			offsetParent: sel.offsetParent ? (sel.offsetParent as HTMLElement).className.slice(0, 40) : null,
			inWin: window.innerWidth + 'x' + window.innerHeight,
		};
	}, ROW);
}

export async function focusSel(): Promise<Record<string, unknown>> {
	return browser.executeObsidian((_o, name) => {
		const row = [...document.querySelectorAll('.setting-item')].find((r) => r.querySelector('.setting-item-name')?.textContent === name);
		const sel = row!.querySelector('select')!;
		sel.focus();
		const a = document.activeElement as HTMLElement | null;
		return { syncActive: a?.tagName ?? null, syncSelFocus: sel.matches(':focus'), hasFocus: document.hasFocus() };
	}, ROW);
}

/** Marks the select now and returns a WebDriver element for it (no redraw between the two calls). */
export async function selectEl() {
	await browser.executeObsidian((_o, name) => {
		document.querySelectorAll('[data-probe]').forEach((e) => e.removeAttribute('data-probe'));
		const row = [...document.querySelectorAll('.setting-item')].find((r) => r.querySelector('.setting-item-name')?.textContent === name);
		row!.querySelector('select')!.setAttribute('data-probe', '1');
	}, ROW);
	return $('select[data-probe="1"]');
}

export async function closeAll(): Promise<void> {
	await browser.executeObsidian(({ app }) => {
		(app as unknown as Host).setting.close();
		document.querySelectorAll('.notice').forEach((n) => n.remove());
	});
}

export async function safe<T>(f: () => Promise<T>): Promise<T | string> {
	try {
		return await f();
	} catch (e) {
		return `ERR ${String((e as Error)?.message ?? e).slice(0, 200)}`;
	}
}
