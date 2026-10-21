import { expect } from '@wdio/globals';
import { pluginId, reloadPlugin } from './load';
describe(`${pluginId} load`, function () {
	it('reloads with no console errors', async function () { expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] }); });
});
