import { expect } from '@wdio/globals';
import { pluginId, reloadPlugin } from './load';
describe('Craft Link Repair load', function () {
	it('loads and reloads without console errors', async function () {
		expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] });
	});
});
