import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { lastNotice, pluginId, reloadPlugin } from './load';

interface CountProperties {
	wordCountTracked: boolean;
	wordCount: number;
	readingTimeMinutes: number;
}

async function properties(path: string): Promise<CountProperties | null> {
	return browser.executeObsidian(({ app }, notePath) => {
		const file = app.vault.getFileByPath(notePath);
		const frontmatter = file ? app.metadataCache.getFileCache(file)?.frontmatter : undefined;
		if (!frontmatter || typeof frontmatter.wordCountTracked !== 'boolean'
			|| typeof frontmatter.wordCount !== 'number'
			|| typeof frontmatter.readingTimeMinutes !== 'number') return null;
		return {
			wordCountTracked: frontmatter.wordCountTracked,
			wordCount: frontmatter.wordCount,
			readingTimeMinutes: frontmatter.readingTimeMinutes,
		};
	}, path);
}

describe(`${pluginId} smoke test`, function () {
	it('is enabled and reloads with no console errors', async function () {
		const state = await reloadPlugin(pluginId);
		expect(state).toEqual({ enabled: true, reloaded: true, errors: [] });
	});

	it('opts in a note and updates numeric fields after an edit', async function () {
		await obsidianPage.write('Smoke.md', '# Hello world');
		await obsidianPage.openFile('Smoke.md');
		await browser.executeObsidianCommand(`${pluginId}:toggle-tracking`);
		await browser.waitUntil(async () => (await lastNotice()).includes('tracking is on'), { timeout: 12000 });
		await browser.waitUntil(async () => (await properties('Smoke.md'))?.wordCount === 2, { timeout: 12000 });
		expect(await properties('Smoke.md')).toEqual({ wordCountTracked: true, wordCount: 2, readingTimeMinutes: 1 });

		await browser.executeObsidian(async ({ app }) => {
			const file = app.vault.getFileByPath('Smoke.md');
			if (!file) throw new Error('Smoke note missing');
			await app.vault.append(file, ' again today');
		});
		await browser.waitUntil(async () => (await properties('Smoke.md'))?.wordCount === 4, { timeout: 12000 });
		expect(await properties('Smoke.md')).toEqual({ wordCountTracked: true, wordCount: 4, readingTimeMinutes: 1 });
	});

	it('keeps counts unchanged during typing and flushes when the note closes', async function () {
		await obsidianPage.write('Idle.md', 'One two');
		await obsidianPage.openFile('Idle.md');
		await browser.executeObsidianCommand(`${pluginId}:toggle-tracking`);
		await browser.waitUntil(async () => (await properties('Idle.md'))?.wordCount === 2, { timeout: 12000 });
		await browser.executeObsidian(({ app }) => {
			const editor = app.workspace.activeEditor?.editor;
			if (!editor) throw new Error('Active editor missing');
			editor.setValue(editor.getValue() + ' three');
		});
		await browser.pause(2500);
		expect((await properties('Idle.md'))?.wordCount).toBe(2);
		await obsidianPage.openFile('Smoke.md');
		await browser.waitUntil(async () => (await properties('Idle.md'))?.wordCount === 3, { timeout: 12000 });
	});

	it('does not overwrite a foreign count beside a manually added marker', async function () {
		await obsidianPage.write('Foreign.md', '---\nwordCountTracked: true\nwordCount: 999\nreadingTimeMinutes: 9\n---\nOne two');
		await obsidianPage.openFile('Foreign.md');
		await browser.pause(6000);
		expect(await properties('Foreign.md')).toEqual({ wordCountTracked: true, wordCount: 999, readingTimeMinutes: 9 });
	});

});
