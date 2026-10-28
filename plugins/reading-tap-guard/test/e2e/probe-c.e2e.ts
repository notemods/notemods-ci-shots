// Probe C: CDP through chromedriver (Page.bringToFront, Emulation.setFocusEmulationEnabled), then focus() and keys.
import { browser } from '@wdio/globals';
import { closeAll, dump, focusSel, log, openFree, safe, state } from './probe-util';

type Cdp = { sendCommandAndGetResult(cmd: string, params: object): Promise<unknown> };

describe('probe C focus', function () {
	after(closeAll);
	it('logs focus state after CDP calls', async function () {
		await openFree();
		log('C0-baseline', await state());
		const cdp = browser as unknown as Cdp;
		log('C1-bringToFront', await safe(() => cdp.sendCommandAndGetResult('Page.bringToFront', {})));
		await browser.pause(300);
		log('C1-state', await state());
		log('C2-focus()', await focusSel());
		log('C2-state', await state());
		log('C3-emulation', await safe(() => cdp.sendCommandAndGetResult('Emulation.setFocusEmulationEnabled', { enabled: true })));
		await browser.pause(300);
		log('C3-state', await state());
		log('C4-focus()', await focusSel());
		log('C4-state', await state());
		await browser.keys(['ArrowDown']);
		await browser.pause(1000);
		log('C5-afterArrowDown', await state());
		dump();
	});
});
