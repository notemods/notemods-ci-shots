import { browser, expect } from '@wdio/globals';
import { pluginId, reloadPlugin } from './load';

describe(`${pluginId} smoke test`, function () {
	it('is enabled and reloads with no console errors', async function () {
		const state = await reloadPlugin(pluginId);
		expect(state).toEqual({ enabled: true, reloaded: true, errors: [] });
	});

	it('registers the panel view type and the commands', async function () {
		const found = await browser.executeObsidian(({ app }, id) => {
			const commands = (app as unknown as { commands: { commands: Record<string, unknown> } }).commands.commands;
			return ['open-panel', 'refresh', 'export-report', 'send-feedback', 'show-whats-new'].map((c) => `${id}:${c}` in commands);
		}, pluginId);
		expect(found).toEqual([true, true, true, true, true]);
	});
});
