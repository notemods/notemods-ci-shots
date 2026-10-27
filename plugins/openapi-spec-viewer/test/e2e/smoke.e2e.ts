import { browser, expect } from '@wdio/globals';
import { pluginId, reloadPlugin } from './load';

describe(`${pluginId} smoke test`, () => {
	it('is enabled and reloads without console errors', async () => {
		expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] });
	});
	it('opens the file picker from its command', async () => {
		await browser.executeObsidianCommand(`${pluginId}:open-reference`);
		const text = await browser.execute(() => document.querySelector('.modal')?.textContent);
		expect(text).toContain('Open local API file');
		await browser.execute(() => (document.querySelector('.modal-close-button') as HTMLButtonElement)?.click());
	});
});
