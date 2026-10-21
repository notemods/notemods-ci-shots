import { browser, expect } from '@wdio/globals';
import { pluginId, reloadPlugin } from './load';
describe(`${pluginId} smoke test`, function () {
 it('loads and reloads without console errors', async function () { expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] }); });
 it('opens the CSV chooser from its command', async function () {
  await browser.executeObsidianCommand(`${pluginId}:check-csv`);
  await browser.waitUntil(async () => (await browser.$('.modal-title').getText()) === 'Choose a CSV file', { timeout: 10000 });
  expect(await browser.$('.modal-content').getText()).toContain('people.csv');
  await browser.keys('Escape');
 });
});
