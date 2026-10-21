import { browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId, reloadPlugin } from './load';

interface Importer {
	pro: { opts: { http: unknown }; refreshNow(): Promise<void>; signOut(): void };
	settings: { profiles: { name: string }[] };
	importBytes(bytes: Uint8Array, folder: string, profile: unknown, baseline?: string): Promise<{ notes: number; assets: number; warnings: string[] }>;
	saveProfile(profile: unknown): Promise<void>;
}
async function setPro(on: boolean): Promise<void> {
	await browser.executeObsidian(async ({ app }, id, enabled) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, Importer> } }).plugins.plugins[id]!;
		if (!enabled) { p.pro.signOut(); return; }
		p.pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
		app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
		await p.pro.refreshNow();
	}, pluginId, on);
}
const demo = Array.from(readFileSync('docs/sample-notes/Demo export.zip'));
const later = Array.from(readFileSync('docs/sample-notes/Later export.zip'));

describe('native import in Obsidian', function () {
	before(async () => { await setPro(false); });
	it('the free dialog reads one ZIP and its button creates notes, tasks and assets', async function () {
		await browser.executeObsidianCommand(`${pluginId}:import`);
		await browser.waitUntil(async () => browser.execute(() => !!document.querySelector('.zoho-import-dialog input[type="file"]')), { timeout: 10000, timeoutMsg: 'Import dialog did not open' });
		await browser.$('.zoho-import-dialog input[type="file"]').setValue(resolve('docs/sample-notes/Demo export.zip'));
		await browser.$('.zoho-import-dialog input[type="text"]').setValue('E2E import');
		await browser.waitUntil(async () => browser.execute(() => document.querySelector('.zoho-import-status')?.textContent?.includes('5 cards') ?? false), { timeout: 10000, timeoutMsg: 'ZIP counts did not appear' }).catch(async error => { throw new Error(`${String(error)}; status: ${await browser.execute(() => document.querySelector('.zoho-import-status')?.textContent ?? 'missing status')}`); });
		expect(await browser.execute(() => (document.querySelector('.zoho-import-dialog textarea') as HTMLTextAreaElement).disabled)).toBe(true);
		await browser.$('.zoho-import-dialog').$('button=Import cards').click();
		await browser.waitUntil(async () => browser.execute(() => document.querySelector('.zoho-import-status')?.textContent?.startsWith('Import complete.') ?? false), { timeout: 15000, timeoutMsg: 'Import did not complete' });
		const tasks = await obsidianPage.read('E2E import/Travel journal/Packing list.md');
		expect(tasks).toContain('- [x] Book the train tickets'); expect(tasks).toContain('- [ ] Pack a water bottle');
		const state = await browser.executeObsidian(async ({ app }) => {
			const asset = app.vault.getFileByPath('E2E import/assets/photo/photo.jpeg')!;
			const report = app.vault.getFileByPath('E2E import/Import report.md')!;
			return { assetBytes: (await app.vault.readBinary(asset)).byteLength, report: await app.vault.read(report) };
		});
		expect(state.assetBytes).toBe(114618); expect(state.report).toContain('Unsupported card type note/sketch'); expect(state.report).toContain('resource absent or ambiguous missing.png');
		await browser.keys('Escape');
	});
	it('a folder conflict makes no writes and free access rejects review', async function () {
		const result = await browser.executeObsidian(async ({ app }, id, bytes) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, Importer> } }).plugins.plugins[id]!;
			const before = app.vault.getFiles().length;
			let conflict = ''; let pro = '';
			try { await p.importBytes(new Uint8Array(bytes), 'E2E import', null); } catch (e) { conflict = String(e); }
			try { await p.importBytes(new Uint8Array(bytes), 'Free review', null, 'E2E import'); } catch (e) { pro = String(e); }
			return { conflict, pro, writes: app.vault.getFiles().length - before };
		}, pluginId, demo);
		expect(result.conflict).toContain('Output folder exists'); expect(result.pro).toContain('Pro'); expect(result.writes).toBe(0);
	});
	it('Pro saves a profile across reload and imports mapped properties', async function () {
		await setPro(true);
		await browser.executeObsidian(async ({ app }, id, bytes) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, Importer> } }).plugins.plugins[id]!;
			const profile = { name: 'Travel', notebookFolders: { 'Travel journal': 'Trips' }, fields: { color: 'card_color' } };
			await p.saveProfile(profile); await p.importBytes(new Uint8Array(bytes), 'Mapped import', profile);
		}, pluginId, demo);
		expect(await obsidianPage.read('Mapped import/Trips/Weekend plan.md')).toContain('card_color:');
		expect((await reloadPlugin(pluginId)).errors).toEqual([]);
		expect(await browser.executeObsidian(({ app }, id) => (app as unknown as { plugins: { plugins: Record<string, Importer> } }).plugins.plugins[id]!.settings.profiles.map(p => p.name), pluginId)).toEqual(['Travel']);
	});
	it('Pro review copies changed and new cards and leaves the baseline note intact', async function () {
		await setPro(true); const before = await obsidianPage.read('E2E import/Travel journal/Weekend plan.md');
		const result = await browser.executeObsidian(async ({ app }, id, bytes) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, Importer> } }).plugins.plugins[id]!;
			return p.importBytes(new Uint8Array(bytes), 'E2E review', null, 'E2E import');
		}, pluginId, later);
		expect(result.notes).toBe(2); expect(result.assets).toBe(0);
		expect(await obsidianPage.read('E2E review/Travel journal/Weekend plan.md')).toContain('Lunch moved to 13:00.');
		expect(await obsidianPage.read('E2E import/Travel journal/Weekend plan.md')).toBe(before);
		expect(await obsidianPage.read('E2E review/Import report.md')).toContain('Unchanged card tasks');
		await setPro(false);
	});
});
