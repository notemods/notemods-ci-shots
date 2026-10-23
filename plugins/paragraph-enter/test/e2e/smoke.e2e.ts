import { browser, expect } from '@wdio/globals';
import { pluginId, reloadPlugin } from './load';

describe(`${pluginId} smoke test`, function () {
	it('is enabled and reloads with no console errors', async function () {
		const state = await reloadPlugin(pluginId);
		expect(state).toEqual({ enabled: true, reloaded: true, errors: [] });
	});

	it('registers both commands and the status bar mark', async function () {
		const found = await browser.executeObsidian(({ app }, id) => {
			const commands = (app as unknown as { commands: { commands: Record<string, { name: string }> } }).commands.commands;
			return {
				toggle: commands[`${id}:toggle`]?.name ?? '',
				lineBreak: commands[`${id}:insert-line-break`]?.name ?? '',
				status: document.querySelector('.status-bar .paragraph-enter-status')?.textContent ?? '',
			};
		}, pluginId);
		expect(found.toggle).toMatch(/Toggle paragraph Enter$/);
		expect(found.lineBreak).toMatch(/Insert line break$/);
		expect(found.status).toBe('¶');
	});
});
