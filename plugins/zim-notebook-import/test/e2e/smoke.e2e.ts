import { browser, expect } from '@wdio/globals';
import { pluginId, reloadPlugin } from './load';
import type ZimNotebookImportPlugin from '../../src/main';

describe('Zim import in Obsidian', function () {
	it('loads and reloads with no errors', async function () {
		expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] });
	});
	it('reviews the plan through the import command and writes linked notes', async function () {
		const result = await browser.executeObsidian(async ({ app }) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, ZimNotebookImportPlugin> } }).plugins.plugins['zim-notebook-import']!;
			await app.vault.createFolder('Zim source');
			const text = 'Content-Type: text/x-zim-wiki\nWiki-Format: zim 0.4\nCreation-Date: 2020-01-02T03:04:05+00:00\n\n====== Project ======\n[[+Child]] and [[:Area:Page|Label]]\n**Bold** //italic//\n1. First\n\t* Child\n\'\'\'\nraw code\n\'\'\'\n{{./image.png}}';
			await app.vault.create('Zim source/Topic.txt', text);
			await app.vault.createFolder('Zim source/Topic');
			await app.vault.create('Zim source/Topic/Child.txt', 'Child text');
			await app.vault.createFolder('Zim source/Area');
			await app.vault.create('Zim source/Area/Page.txt', 'Area text');
			await app.vault.create('Zim source/日本語.txt', '日本語 Café');
			const modal = plugin.openImport();
			const source = modal.contentEl.querySelector<HTMLInputElement>('[aria-label="Source folder"]')!;
			source.value = 'Zim source'; source.dispatchEvent(new Event('input', { bubbles: true }));
			const destination = modal.contentEl.querySelector<HTMLInputElement>('[aria-label="New destination folder"]')!;
			destination.value = 'Zim output'; destination.dispatchEvent(new Event('input', { bubbles: true }));
			await modal.review();
			const shown = modal.contentEl.textContent;
			const prepared = modal.prepared!;
			const imported = await plugin.writeImport(prepared);
			modal.close();
			const note = await app.vault.read(app.vault.getFileByPath('Zim output/Topic.md')!);
			const report = await app.vault.read(app.vault.getFileByPath(imported.report)!);
			return { shown, count: imported.created, note, report, source: await app.vault.read(app.vault.getFileByPath('Zim source/Topic.txt')!), unicode: await app.vault.read(app.vault.getFileByPath('Zim output/日本語.md')!), text };
		});
		expect(result.shown).toContain('4 planned notes');
		expect(result.count).toBe(4);
		expect(result.note).toContain('# Project');
		expect(result.note).toContain('[[Zim output/Topic/Child]]');
		expect(result.note).toContain('[[Zim output/Area/Page|Label]]');
		expect(result.note).toContain('zim_created:');
		expect(result.note).toContain('**Bold** *italic*');
		expect(result.note).toContain('```\nraw code\n```');
		expect(result.note).toContain('{{./image.png}}');
		expect(result.source).toBe(result.text);
		expect(result.unicode).toContain('日本語 Café');
		expect(result.report).toContain('syntax');
	});
	it('stops case collisions and existing paths before a write', async function () {
		const result = await browser.executeObsidian(async ({ app }) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, ZimNotebookImportPlugin> } }).plugins.plugins['zim-notebook-import']!;
			const existing = await plugin.prepare('Zim source', 'Zim output');
			await app.vault.createFolder('Colliding source');
			await app.vault.create('Colliding source/Two_words.txt', 'one');
			await app.vault.create('Colliding source/Two words.txt', 'two');
			const collision = await plugin.prepare('Colliding source', 'Collision output');
			let stopped = false;
			try { await plugin.writeImport(collision); } catch { stopped = true; }
			return { existing: existing.plan.conflicts, collision: collision.plan.conflicts, stopped, output: !!app.vault.getAbstractFileByPath('Collision output') };
		});
		expect(result.existing.length).toBeGreaterThan(0);
		expect(result.collision.join('\n')).toContain('Two words.txt');
		expect(result.collision.join('\n')).toContain('Two_words.txt');
		expect(result.stopped).toBe(true); expect(result.output).toBe(false);
	});
	it('guards Pro features and previews changes with a local sponsor fixture', async function () {
		const result = await browser.executeObsidian(async ({ app }) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, ZimNotebookImportPlugin> } }).plugins.plugins['zim-notebook-import']!;
			plugin.pro!.signOut();
			const free = await plugin.saveRules('Zim source', 'Later output', { folders: 'flat', names: 'hyphens' });
			const freePreview = await plugin.laterPreview();
			// Local test transport. No GitHub request or payment is made.
			const pro = plugin.pro as unknown as { opts: { http: () => Promise<unknown> } };
			pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'fixture' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
			app.secretStorage.setSecret('zim-notebook-import-github-token', 'gho_' + '0'.repeat(36));
			await plugin.pro!.refreshNow();
			const saved = await plugin.saveRules('Zim source', 'Later output', { folders: 'flat', names: 'hyphens' });
			await app.vault.modify(app.vault.getFileByPath('Zim source/Topic.txt')!, 'New source text');
			await app.vault.create('Zim source/New.txt', 'New page');
			const preview = await plugin.laterPreview();
			const savedRule = plugin.settings.saved;
			plugin.pro!.signOut();
			return { free, freePreview, saved, preview, savedRule };
		});
		expect(result.free).toBe(false); expect(result.freePreview).toBeNull(); expect(result.saved).toBe(true);
		expect(result.preview?.changed).toEqual(['Zim source/Topic.txt']);
		expect(result.preview?.added).toEqual(['Zim source/New.txt']);
		expect(result.savedRule?.rules).toEqual({ folders: 'flat', names: 'hyphens' });
	});
});
