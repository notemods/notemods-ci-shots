import { browser, expect } from '@wdio/globals';
import { pluginId, reloadPlugin } from './load';

describe(`${pluginId} smoke test`, function () {
	it('closes its dialog and reloads with no console errors', async function () {
		await browser.executeObsidianCommand(`${pluginId}:import`);
		expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] });
		expect(await browser.execute(() => document.querySelector('.zoho-import-dialog input'))).toBeNull();
	});
});
