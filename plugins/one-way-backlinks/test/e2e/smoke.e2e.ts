import { browser, expect } from '@wdio/globals';
import { pluginId, reloadPlugin } from './load';

describe(`${pluginId} smoke test`, function () {
	it('is enabled and reloads with no console errors', async function () {
		const state = await reloadPlugin(pluginId);
		expect(state).toEqual({ enabled: true, reloaded: true, errors: [] });
	});

	it('has the command that opens the pane', async function () {
		const has = await browser.executeObsidian(({ app }, id) => `${id}:open` in (app as unknown as { commands: { commands: Record<string, unknown> } }).commands.commands, pluginId);
		expect(has).toBe(true);
	});
});
