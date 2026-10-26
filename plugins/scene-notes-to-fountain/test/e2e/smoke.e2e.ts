import { browser, expect } from '@wdio/globals';
import { pluginId, reloadPlugin } from './load';

describe(`${pluginId} smoke test`, function () {
	it('is enabled and reloads with no console errors', async function () {
		const state = await reloadPlugin(pluginId);
		expect(state).toEqual({ enabled: true, reloaded: true, errors: [] });
	});

	it('registers its commands and the Send feedback and What is new commands', async function () {
		const ids = await browser.executeObsidian(({ app }) => {
			const commands = (app as unknown as { commands: { commands: Record<string, unknown> } }).commands.commands;
			return Object.keys(commands).filter((id) => id.startsWith('scene-notes-to-fountain:')).sort();
		});
		expect(ids).toEqual([
			'scene-notes-to-fountain:export-groups',
			'scene-notes-to-fountain:export-outline',
			'scene-notes-to-fountain:send-feedback',
			'scene-notes-to-fountain:show-whats-new',
		]);
	});
});
