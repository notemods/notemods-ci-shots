import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId, reloadPlugin } from './load';

describe(`${pluginId} smoke test`, function () {
	it('is enabled and reloads with no console errors', async function () {
		const state = await reloadPlugin(pluginId);
		expect(state).toEqual({ enabled: true, reloaded: true, errors: [] });
	});

	it('inserts a board embed from the board picker', async function () {
		await obsidianPage.write('Insert test.md', '');
		await obsidianPage.openFile('Insert test.md');
		await browser.executeObsidianCommand(`${pluginId}:insert-board-embed`);
		const input = await browser.$('.prompt-input');
		await input.waitForDisplayed({ timeout: 5000 });
		await input.setValue('Mobile app');
		await browser.keys('Enter');
		await browser.waitUntil(
			async () =>
				browser.executeObsidian(async ({ app }) => {
					const f = app.vault.getFileByPath('Insert test.md');
					return f ? (await app.vault.read(f)).includes('board: [[Mobile app]]') : false;
				}),
			{ timeout: 5000, timeoutMsg: 'the embed block was not inserted' },
		);
	});
});
