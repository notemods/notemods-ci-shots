import { browser, expect } from '@wdio/globals';
import { pluginId, reloadPlugin } from './load';

describe(`${pluginId} smoke test`, function () {
	it('is enabled and reloads with no console errors', async function () {
		const state = await reloadPlugin(pluginId);
		expect(state).toEqual({ enabled: true, reloaded: true, errors: [] });
	});

	it('registers the three commands', async function () {
		const ids = await browser.executeObsidian(({ app }) => Object.keys((app as unknown as { commands: { commands: Record<string, unknown> } }).commands.commands));
		for (const c of ['copy-github-heading-link', 'convert-note-links', 'convert-vault-links']) expect(ids).toContain(`${pluginId}:${c}`);
	});
});
