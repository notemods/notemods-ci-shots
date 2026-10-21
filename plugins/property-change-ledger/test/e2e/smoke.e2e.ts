import { expect } from '@wdio/globals';
import { pluginId, reloadPlugin } from './load';
describe(`${pluginId} load`, () => {
	it('loads and reloads without errors', async () => expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] }));
});
