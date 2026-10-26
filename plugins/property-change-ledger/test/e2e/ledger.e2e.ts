import { browser, expect } from '@wdio/globals';
import type Plugin from '../../src/main';
import type { Change } from '../../src/ledger';
import { pluginId } from './load';
interface Plugins { plugins: Record<string, Plugin>; disablePlugin(id: string): Promise<void>; enablePlugin(id: string): Promise<boolean> }
let serial = 0;
let folder = '';
let ledger = '';
const initial = '---\nstatus: draft\ndue: 2026-10-20\ntags: [a, b]\n---\nSample body\n';
async function history(): Promise<Change[]> { return browser.executeObsidian(async ({ app }, id) => (app as unknown as { plugins: Plugins }).plugins.plugins[id]!.history(), pluginId); }
async function edit(path: string, text: string): Promise<void> {
	await browser.executeObsidian(async ({ app }, id, path, text) => {
		const event = new Promise<void>(resolve => { const ref = app.metadataCache.on('changed', f => { if (f.path === path) { app.metadataCache.offref(ref); resolve(); } }); });
		await app.vault.process(app.vault.getFileByPath(path)!, () => text); await event;
		await (app as unknown as { plugins: Plugins }).plugins.plugins[id]!.flush();
	}, pluginId, path, text);
}
describe('observed changes in a real vault', () => {
	beforeEach(async () => {
		folder = `Cases ${++serial}`; ledger = `Case ledger ${serial}.md`;
		await browser.executeObsidian(async ({ app }, id, folder, ledger, initial) => {
			await app.vault.createFolder(folder);
			await app.vault.create(folder + '/A.md', initial); await app.vault.create(folder + '/B.md', initial);
			await (app as unknown as { plugins: Plugins }).plugins.plugins[id]!.applyWatch({ folder, keys: 'status, due, tags', ledger });
		}, pluginId, folder, ledger, initial);
		await browser.waitUntil(async () => browser.executeObsidian(({ app }, id, folder) => {
			const p = (app as unknown as { plugins: Plugins }).plugins.plugins[id]!;
			return p.ready && p.observer.baseline.has(folder + '/A.md') && p.observer.baseline.has(folder + '/B.md');
		}, pluginId, folder), { timeout: 10000 });
	});
	it('sets a baseline and ignores body edits', async () => {
		expect(await history()).toEqual([]); await edit(folder + '/A.md', initial + 'New body\n'); expect(await history()).toEqual([]);
	});
	it('records one transition with UTC time and ignores duplicate values', async () => {
		await edit(folder + '/A.md', initial.replace('draft', 'done')); await edit(folder + '/A.md', initial.replace('draft', 'done') + 'New body\n');
		const records = await history(); expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({ path: folder + '/A.md', key: 'status', old: { value: 'draft' }, new: { value: 'done' } }); expect(records[0]!.time).toMatch(/Z$/);
	});
	it('records deleted values and list order', async () => {
		await edit(folder + '/A.md', initial.replace('due: 2026-10-20\n', '').replace('[a, b]', '[b, a]'));
		const records = await history(); expect(records).toHaveLength(2);
		expect(records.find(r => r.key === 'due')?.new).toEqual({ missing: true }); expect(records.find(r => r.key === 'tags')?.new).toEqual({ value: ['b', 'a'] });
	});
	it('keeps two quick note changes', async () => {
		await Promise.all([edit(folder + '/A.md', initial.replace('draft', 'done')), edit(folder + '/B.md', initial.replace('draft', 'done'))]);
		expect((await history()).map(r => r.path).sort()).toEqual([folder + '/A.md', folder + '/B.md']);
	});
	it('moves the baseline on rename', async () => {
		await browser.executeObsidian(async ({ app }, folder) => app.fileManager.renameFile(app.vault.getFileByPath(folder + '/A.md')!, folder + '/Renamed.md'), folder);
		await edit(folder + '/Renamed.md', initial + 'New body\n'); expect(await history()).toEqual([]);
		await edit(folder + '/Renamed.md', initial.replace('draft', 'done')); expect((await history())[0]?.path).toBe(folder + '/Renamed.md');
	});
	it('sets a new baseline after edits with the plugin disabled', async () => {
		await browser.executeObsidian(async ({ app }, id, folder, initial) => {
			const plugins = (app as unknown as { plugins: Plugins }).plugins; await plugins.disablePlugin(id);
			const path = folder + '/A.md';
			const event = new Promise<void>(resolve => { const ref = app.metadataCache.on('changed', f => { if (f.path === path) { app.metadataCache.offref(ref); resolve(); } }); });
			await app.vault.process(app.vault.getFileByPath(path)!, () => initial.replace('draft', 'done')); await event; await plugins.enablePlugin(id);
		}, pluginId, folder, initial);
		expect(await history()).toEqual([]);
	});
	it('filters recent records and guards profiles and CSV', async () => {
		await edit(folder + '/A.md', initial.replace('draft', 'done')); await browser.executeObsidianCommand(pluginId + ':recent-history');
		await browser.waitUntil(async () => await (await browser.$$('.property-change-ledger-table tbody tr')).length === 1, { timeout: 10000 });
		const inputs = await browser.$$('.property-change-ledger-modal input'); await inputs[0]!.setValue('No match');
		await browser.waitUntil(async () => await (await browser.$$('.property-change-ledger-table tbody tr')).length === 0, { timeout: 10000 }); await browser.keys('Escape');
		const result = await browser.executeObsidian(async ({ app }, id) => { const p = (app as unknown as { plugins: Plugins }).plugins.plugins[id]!; p.pro!.signOut(); return [await p.saveProfile('Free'), await p.exportCsv('', '')]; }, pluginId);
		expect(result).toEqual([false, null]);
	});
	it('uses the cached Sponsors answer for profiles, counts and CSV', async () => {
		await edit(folder + '/A.md', initial.replace('draft', 'done'));
		const result = await browser.executeObsidian(async ({ app }, id) => {
			const p = (app as unknown as { plugins: Plugins }).plugins.plugins[id]!;
			p.pro!.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
			app.secretStorage.setSecret(id + '-github-token', 'gho_' + '0'.repeat(36)); await p.pro!.refreshNow();
			await p.saveProfile('Review'); const path = await p.exportCsv('A.md', 'status');
			return { profile: p.settings.profiles[0]?.name, text: await app.vault.read(app.vault.getFileByPath(path!)!) };
		}, pluginId);
		expect(result.profile).toBe('Review'); expect(result.text).toContain('draft'); await browser.executeObsidianCommand(pluginId + ':recent-history');
		await browser.waitUntil(async () => (await browser.$('.property-change-ledger-results ul')).isExisting(), { timeout: 10000 });
		expect(await browser.$('.property-change-ledger-results ul').getText()).toContain(folder + '/A.md: 1'); await browser.keys('Escape');
		await browser.executeObsidian(({ app }, id) => (app as unknown as { plugins: Plugins }).plugins.plugins[id]!.pro!.signOut(), pluginId);
	});
});
