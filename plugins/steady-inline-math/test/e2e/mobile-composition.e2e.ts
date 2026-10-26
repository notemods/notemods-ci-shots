import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';

async function text() {
	return browser.executeObsidian(({ app, plugins }) => {
		const p = plugins.steadyInlineMath;
		const v = [...p.guard.views].find((v) => p.filePath(v.state) === app.workspace.getActiveFile()?.path && v.dom.isConnected);
		return v?.state.doc.toString() ?? '';
	});
}
describe('synthetic composition in the emulated mobile UI', function () {
	it('keeps Japanese input and resumes the guard after composition', async function () {
		expect(await browser.executeObsidian(({ obsidian }) => obsidian.Platform.isMobile)).toBe(true);
		expect(await browser.execute(() => window.innerWidth)).toBeLessThan(600);
		await obsidianPage.write('Composition.md', 'Result $x$ end'); await obsidianPage.openFile('Composition.md');
		await browser.waitUntil(async () => (await text()) === 'Result $x$ end', { timeout: 10000, interval: 50, timeoutMsg: 'The mobile editor did not open' });
		await browser.executeObsidian(({ app, plugins }) => {
			const p = plugins.steadyInlineMath; const v = [...p.guard.views].find((v) => p.filePath(v.state) === app.workspace.getActiveFile()?.path && v.dom.isConnected)!;
			v.focus(); v.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
			v.dispatch({ selection: { anchor: 8 } }); v.dispatch({ changes: { from: 8, insert: '日' }, selection: { anchor: 9 }, userEvent: 'input.type.compose' });
		});
		expect(await text()).toBe('Result $日x$ end');
		await browser.executeObsidian(({ app, plugins }) => {
			const p = plugins.steadyInlineMath; const v = [...p.guard.views].find((v) => p.filePath(v.state) === app.workspace.getActiveFile()?.path && v.dom.isConnected)!;
			v.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
		});
		await browser.waitUntil(async () => (await text()) === 'Result ${}日x{}$ end', { timeout: 10000, interval: 50, timeoutMsg: 'The mobile guard did not resume' });
		await browser.executeObsidian(({ app, plugins }) => { const p = plugins.steadyInlineMath; const v = [...p.guard.views].find((v) => p.filePath(v.state) === app.workspace.getActiveFile()?.path && v.dom.isConnected)!; v.dispatch({ selection: { anchor: 0 } }); });
		expect(await text()).toBe('Result $日x$ end');
	});
});
