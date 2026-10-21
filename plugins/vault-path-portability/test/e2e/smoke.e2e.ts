import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId, reloadPlugin } from './load';

describe(`${pluginId} path report`, function () {
	it('loads and reloads without console errors', async function () {
		const state = await reloadPlugin(pluginId);
		expect(state).toEqual({ enabled: true, reloaded: true, errors: [] });
	});
	it('reports a reserved name without changing the note', async function () {
		await obsidianPage.write('CON.md', 'A sample reserved device name.');
		await browser.executeObsidianCommand(`${pluginId}:scan-vault-paths`);
		await browser.waitUntil(async () => (await browser.$('.vpp-report').getText()).includes('CON.md'), { timeout: 10000 });
		expect(await browser.$('.vpp-report').getText()).toContain('Windows reserved names');
		await browser.$('.vpp-report').$('button=Review rename').click();
		expect(await browser.$('.vpp-rename-review').getText()).toContain('_CON.md');
		expect(await browser.$('.vpp-rename-review').getText()).toContain('Applying a suggestion needs pro');
		expect(await browser.$('.vpp-rename-review').$('button=Rename this path').isEnabled()).toBe(false);
		await browser.$('.vpp-rename-review').$('button=Cancel').click();
		const body = await browser.executeObsidian(async ({ app }) => {
			const file = app.vault.getFileByPath('CON.md');
			return file ? await app.vault.read(file) : null;
		});
		expect(body).toBe('A sample reserved device name.');
	});
 it('reports a real case collision and discloses the normalized index boundary', async function () {
  await obsidianPage.write('Note.md', 'Upper case example.');
  await obsidianPage.write('note.md', 'Lower case example.');
  await browser.executeObsidianCommand(`${pluginId}:scan-vault-paths`);
  await browser.waitUntil(async () => (await browser.$('.vpp-report').getText()).includes('Case-fold collisions'), { timeout: 10000 });
  const report = await browser.$('.vpp-report').getText();
  expect(report).toContain('Note.md'); expect(report).toContain('note.md');
  expect(report).toContain('NFC/NFD collisions');
  expect(report).toContain('current absolute vault root');
 });

});
