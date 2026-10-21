import { browser, expect } from '@wdio/globals';
import { pluginId, reloadPlugin } from './load';

describe(`${pluginId} smoke test`, function () {
	it('is enabled and reloads with no console errors', async function () {
		const state = await reloadPlugin(pluginId);
		expect(state).toEqual({ enabled: true, reloaded: true, errors: [] });
	});

	it('opens the export window from the command', async function () {
		await browser.executeObsidianCommand(`${pluginId}:open-export`);
		await browser.$('.note-ris-export [data-action="export"]').waitForExist();
		await browser.executeObsidian(({ app }, id) => {
			(app as unknown as { plugins: { plugins: Record<string, { modal: { close(): void } | null }> } }).plugins.plugins[id]!.modal?.close();
		}, pluginId);
	});
});
