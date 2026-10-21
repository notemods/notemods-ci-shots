import { browser, expect } from '@wdio/globals';
import { pluginId, reloadPlugin } from './load';

describe(`${pluginId} smoke test`, function () {
	it('loads and reloads without console errors', async function () {
		expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] });
	});
	it('registers the free and Pro commands without default hotkeys', async function () {
		const ids = await browser.executeObsidian(({ app }, id) => {
			const commands = (app as unknown as { commands: { commands: Record<string, { hotkeys?: unknown[] }> } }).commands.commands;
			return ['convert-selection', 'convert-column'].map((name) => ({ found: `${id}:${name}` in commands, hotkeys: commands[`${id}:${name}`]?.hotkeys ?? [] }));
		}, pluginId);
		expect(ids).toEqual([{ found: true, hotkeys: [] }, { found: true, hotkeys: [] }]);
	});
});
