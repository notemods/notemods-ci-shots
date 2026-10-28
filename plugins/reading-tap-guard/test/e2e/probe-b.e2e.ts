// Probe B: real WebDriver input only (click on the select, Escape, ArrowDown), no script focus.
import { browser } from '@wdio/globals';
import { closeAll, dump, log, openFree, safe, selDiag, selectEl, state } from './probe-util';

describe('probe B focus', function () {
	after(closeAll);
	it('logs focus state after a WebDriver click and keys', async function () {
		await openFree();
		log('B0-baseline', await state());
		log('B0-diag', await selDiag());
		log('B1-switchToWindow', await safe(async () => { const handles = await browser.getWindowHandles(); const cur = await browser.getWindowHandle(); return { handles: handles.length, cur, titles: await Promise.all(handles.map(async (h) => { await browser.switchToWindow(h); return `${h.slice(-6)}:${await browser.getTitle()}:${String(await browser.execute(() => typeof (window as unknown as { app?: unknown }).app))}`; })).finally(() => browser.switchToWindow(cur)) }; }));
		log('B1-state', await state());
		log('B1b-pick', await safe(async () => {
			const out: string[] = [];
			for (const h of await browser.getWindowHandles()) {
				await browser.switchToWindow(h);
				const n = await browser.execute(() => document.querySelectorAll('.setting-item').length);
				out.push(`${h.slice(-6)}=${n}`);
				if (n > 0) break;
			}
			return out;
		}));
		log('B1b-state', await state());
		const el = await selectEl();
		log('B2-click', await safe(async () => { await el.scrollIntoView({ block: 'center' }); await el.click(); return 'ok'; }));
		await browser.pause(300);
		log('B2-state', await state());
		await browser.keys(['Escape']);
		await browser.pause(300);
		log('B3-afterEscape', await state());
		await browser.keys(['ArrowDown']);
		await browser.pause(1000);
		log('B4-afterArrowDown', await state());
		await browser.keys(['Tab']);
		await browser.pause(200);
		log('B5-afterTab', await state());
		dump();
	});
});
