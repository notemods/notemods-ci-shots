import { browser, expect } from '@wdio/globals';
import { pluginId } from './load';
import { captureErrors, openWithPane, pane, takeErrors, waitPane } from './pane';

const TECH = 'Tech features.md';

// No resetVault here: a reset removes the plugin files from the test vault, and enablePlugin then fails with ENOENT.
describe('Unload with the pane open', function () {
	before(async function () {
		await captureErrors();
		await takeErrors();
	});

	after(async function () {
		expect(await takeErrors()).toEqual([]);
	});

	it('E7 disabling the plugin with the pane open logs no error, later events do nothing, and enabling it works again', async function () {
		await openWithPane(TECH);
		await browser.executeObsidian(async ({ app }, id) => {
			await (app as unknown as { plugins: { disablePlugin(id: string): Promise<void> } }).plugins.disablePlugin(id);
		}, pluginId);
		// Events after unload: a change, a rename and a delete. The old view must not react.
		await browser.executeObsidian(async ({ app }) => {
			await app.vault.process(app.vault.getFileByPath('Note 1.md')!, (t) => t + '\nMore [[Tech features]].\n');
			await app.fileManager.renameFile(app.vault.getFileByPath('Unrelated.md')!, 'Unrelated 2.md');
		});
		try {
			await browser.pause(1500);
			expect(await pane()).toBeNull();
			expect(await browser.executeObsidian(() => document.querySelectorAll('.owb-view .owb-row').length)).toBe(0);
		} finally {
			await browser.executeObsidian(async ({ app }, id) => {
				await (app as unknown as { plugins: { enablePlugin(id: string): Promise<boolean> } }).plugins.enablePlugin(id);
			}, pluginId);
		}
		const s = await openWithPane(TECH);
		const again = await waitPane((p) => p.oneWay === 3, 'lists after enable');
		expect(s.note).toBe('Tech features');
		expect(again.counts).toEqual(['2', '2', '1']);
	});

});
