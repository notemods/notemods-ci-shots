import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { lastNotice, pluginId, reloadPlugin } from './load';
import type {} from '../../src/internals';

async function filters(): Promise<unknown> {
	return browser.executeObsidian(({ app }) => app.vault.getConfig?.('userIgnoreFilters'));
}

async function setFilters(value: string[]): Promise<void> {
	await browser.executeObsidian(({ app }, patterns) => app.vault.setConfig?.('userIgnoreFilters', patterns), value);
}

describe(`${pluginId} excluded files`, function () {
	let original: string[];
	before(async function () {
		original = (await filters() as string[] | undefined) ?? [];
	});
	after(async function () {
		await reloadPlugin(pluginId);
		await setFilters(original);
	});

	it('is enabled and reloads with no console errors', async function () {
		expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] });
	});

	it('reveals an excluded note in an open Base and restores it with the command', async function () {
		await setFilters(['Archive/']);
		await obsidianPage.openFile('Board.base');
		const baseText = () => browser.executeObsidian(() => document.querySelector('.workspace-leaf.mod-active .bases-view')?.textContent ?? '');
		await browser.waitUntil(async () => (await baseText()).includes('Current'), { timeout: 10000 });
		expect(await baseText()).not.toContain('Old research');
		await browser.executeObsidianCommand(`${pluginId}:toggle-visibility`);
		await browser.waitUntil(async () => JSON.stringify(await filters()) === '[]', { timeout: 5000 });
		await browser.waitUntil(async () => (await baseText()).includes('Old research'), { timeout: 10000 });
		await browser.executeObsidianCommand(`${pluginId}:toggle-visibility`);
		await browser.waitUntil(async () => JSON.stringify(await filters()) === '["Archive/"]', { timeout: 5000 });
		await browser.waitUntil(async () => !(await baseText()).includes('Old research'), { timeout: 10000 });
		expect(await baseText()).toContain('Current');
	});

	it('merges patterns added while files are visible', async function () {
		await setFilters(['Archive/']);
		await browser.executeObsidianCommand(`${pluginId}:toggle-visibility`);
		await browser.waitUntil(async () => JSON.stringify(await filters()) === '[]', { timeout: 5000 });
		await setFilters(['Templates/']);
		await browser.executeObsidianCommand(`${pluginId}:toggle-visibility`);
		await browser.waitUntil(async () => JSON.stringify(await filters()) === '["Archive/","Templates/"]', { timeout: 5000 });
	});

	it('restores patterns when the plugin is disabled and reloaded', async function () {
		await setFilters(['Archive/']);
		await browser.executeObsidianCommand(`${pluginId}:toggle-visibility`);
		await browser.waitUntil(async () => JSON.stringify(await filters()) === '[]', { timeout: 5000 });
		expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] });
		expect(await filters()).toEqual(['Archive/']);
	});

	it('leaves an empty list unchanged and explains how to configure exclusions', async function () {
		await setFilters([]);
		await browser.executeObsidianCommand(`${pluginId}:toggle-visibility`);
		await browser.waitUntil(async () => (await lastNotice()).includes('excluded files list is empty'), { timeout: 5000 });
		expect(await filters()).toEqual([]);
	});
});
