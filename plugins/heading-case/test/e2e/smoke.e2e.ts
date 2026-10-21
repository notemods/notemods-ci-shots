import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { lastNotice, pluginId, reloadPlugin } from './load';

const before = '# Notes From The Trip\n\nBody Text Stays As Typed.\n\n## WHAT WE SAW ON DAY TWO\n';
const after = '# Notes from the trip\n\nBody Text Stays As Typed.\n\n## What we saw on day two\n';

describe(`${pluginId} smoke test`, function () {
	it('is enabled and reloads with no console errors', async function () {
		const state = await reloadPlugin(pluginId);
		expect(state).toEqual({ enabled: true, reloaded: true, errors: [] });
	});

	it('converts every heading to sentence case in one edit', async function () {
		await obsidianPage.write('Smoke.md', before);
		await obsidianPage.openFile('Smoke.md');
		await browser.executeObsidianCommand(`${pluginId}:convert-headings-sentence-case`);
		await browser.waitUntil(async () => (await lastNotice()) === 'Changed 2 of 2 headings to sentence case.', {
			timeout: 5000,
			timeoutMsg: 'no "Changed 2 of 2 headings" notice',
		});
		const text = await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.getValue() ?? '');
		expect(text).toBe(after);
	});
});
