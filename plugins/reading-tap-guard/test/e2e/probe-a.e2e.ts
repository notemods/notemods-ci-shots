// Probe A: passive state, element.focus(), window.focus(), Electron window focus.
import { browser } from '@wdio/globals';
import { closeAll, dump, focusSel, log, openFree, safe, selDiag, state } from './probe-util';

describe('probe A focus', function () {
	after(closeAll);
	it('logs focus state after script and Electron focus calls', async function () {
		await openFree();
		log('A0-baseline', await state());
		log('A0-diag', await selDiag());
		log('A1-focus()', await focusSel());
		log('A1-state', await state());
		log('A2-window.focus', await safe(() => browser.executeObsidian(() => { window.focus(); activeWindow.focus(); return { main: document.hasFocus(), active: activeDocument.hasFocus() }; })));
		await browser.pause(300);
		log('A2-state', await state());
		log('A3-electron', await safe(() => browser.executeObsidian(async () => {
			const out: Record<string, unknown> = {};
			const req = (window as unknown as { require?: (m: string) => unknown }).require;
			out.hasRequire = typeof req;
			let win: { isFocused(): boolean; focus(): void; show(): void; isVisible(): boolean } | null = null;
			try {
				const el = req!('electron') as Record<string, unknown>;
				out.electronKeys = Object.keys(el).slice(0, 30);
				const remote = el.remote as { getCurrentWindow(): typeof win } | undefined;
				if (remote) win = remote.getCurrentWindow();
				out.viaElectronRemote = !!remote;
			} catch (e) { out.electronErr = String(e); }
			if (!win) {
				try {
					const r = req!('@electron/remote') as { getCurrentWindow(): typeof win };
					win = r.getCurrentWindow();
					out.viaAtRemote = true;
				} catch (e) { out.atRemoteErr = String(e); }
			}
			if (win) {
				out.before = { focused: win.isFocused(), visible: win.isVisible() };
				win.show();
				win.focus();
				await new Promise((r) => setTimeout(r, 500));
				out.after = { focused: win.isFocused(), hasFocus: activeDocument.hasFocus() };
			}
			return out;
		})));
		log('A3-state', await state());
		log('A4-focus()', await focusSel());
		log('A4-state', await state());
		await browser.keys(['ArrowDown']);
		await browser.pause(800);
		log('A5-afterArrowDown', await state());
		dump();
	});
});
