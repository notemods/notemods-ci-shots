import { browser, expect } from '@wdio/globals';
import { pluginId, reloadPlugin } from './load';

describe(`${pluginId} smoke test`, function () {
	it('is enabled and reloads with no console errors', async function () {
		const state = await reloadPlugin(pluginId);
		expect(state).toEqual({ enabled: true, reloaded: true, errors: [] });
	});

	it('registers the solve, history, feedback and What\'s new commands', async function () {
		const ids = await browser.executeObsidian(({ app }, id) => {
			const commands = (app as unknown as { commands: { commands: Record<string, unknown> } }).commands.commands;
			return Object.keys(commands).filter((c) => c.startsWith(`${id}:`)).sort();
		}, pluginId);
		expect(ids).toEqual([`${pluginId}:search-history`, `${pluginId}:send-feedback`, `${pluginId}:show-whats-new`, `${pluginId}:solve`]);
	});
});
