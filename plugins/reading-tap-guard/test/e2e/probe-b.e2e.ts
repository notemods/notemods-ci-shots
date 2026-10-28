// Probe B: real WebDriver input only (click on the select, Escape, ArrowDown), no script focus.
import { browser } from '@wdio/globals';
import { closeAll, dump, log, openFree, safe, selDiag, selectEl, state } from './probe-util';

describe('probe B focus', function () {
	after(closeAll);
	it('logs focus state after a WebDriver click and keys', async function () {
		await openFree();
		log('B0-baseline', await state());
		log('B0-diag', await selDiag());
		log('B1-switchToWindow', await safe(async () => { await browser.switchToWindow(await browser.getMainWindowHandle()); return 'ok'; }));
		log('B1-state', await state());
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
