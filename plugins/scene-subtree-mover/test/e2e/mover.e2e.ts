import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import type { TFile } from 'obsidian';
import type SceneSubtreeMoverPlugin from '../../src/main';
import { pluginId } from './load';

const initial = '---\ntitle: Test manuscript\ncustom: keep\nlongform:\n  format: scenes\n  sceneFolder: Scenes\n  scenes:\n    - A\n    - - a1\n      - - x\n    - B\n    - - b1\n    - C\n---\n\n# Manuscript\nBody stays here.\n';
const root = '.scene-subtree-mover-modal';

async function openIndex(path: string): Promise<void> {
	await obsidianPage.write(path, initial);
	await obsidianPage.openFile(path);
	await browser.waitUntil(async () => browser.executeObsidian(({ app }, p) => app.workspace.getActiveFile()?.path === p, path), { timeout: 15000, timeoutMsg: 'Index did not become active' });
	await browser.executeObsidianCommand(`${pluginId}:move-chapter`);
	await browser.$(`${root} [data-field="chapter"]`).waitForExist();
}
async function ready(text: string): Promise<void> {
	await browser.waitUntil(async () => {
		const status = await browser.$(`${root} .ssm-status`);
		return await status.isExisting() && await status.getAttribute('data-pending') === 'false' && (await status.getText()).includes(text);
	}, { timeout: 15000, timeoutMsg: `Mover status did not contain ${text}` });
}
async function stage(position: number, chapter = '[0]'): Promise<void> {
	await browser.$(`${root} [data-field="chapter"]`).selectByAttribute('value', chapter);
	await browser.$(`${root} [data-field="position"]`).selectByAttribute('value', String(position));
	await browser.$(`${root} [data-action="preview"]`).click();
	await ready('in the preview');
}
async function sourceState(path: string) {
	return browser.executeObsidian(async ({ app, obsidian }, p) => {
		const source = await app.vault.read(app.vault.getFileByPath(p)!);
		const info = obsidian.getFrontMatterInfo(source);
		const data = obsidian.parseYaml(info.frontmatter) as { custom: string; longform: { scenes: unknown } };
		return { source, body: source.slice(info.contentStart), scenes: data.longform.scenes, custom: data.custom };
	}, path);
}
async function fakeSponsor(): Promise<void> {
	await browser.executeObsidian(async ({ app }) => {
		const plugin = (app as unknown as { plugins: { plugins: Record<string, SceneSubtreeMoverPlugin> } }).plugins.plugins['scene-subtree-mover'];
		// Test transport only. No account or network request is used.
		(plugin.pro as unknown as { opts: { http: () => Promise<unknown> } }).opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'test-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
		app.secretStorage.setSecret('scene-subtree-mover-github-token', 'gho_' + '0'.repeat(36));
		await plugin.pro!.refreshNow();
	});
}

describe('Scene Subtree Mover in a real vault', function () {
	afterEach(async function () {
		if (await browser.$(root).isExisting()) await browser.keys('Escape');
		await browser.waitUntil(async () => !(await browser.$(root).isExisting()), { timeout: 15000 });
		await browser.executeObsidian(({ app }) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, SceneSubtreeMoverPlugin> } }).plugins.plugins['scene-subtree-mover'];
			plugin.pro!.signOut();
		});
	});
	it('previews and applies a free chapter move with descendants and a full backup', async function () {
		await openIndex('Free.md'); await stage(2);
		expect(await browser.$(`${root} [data-tree="after"]`).getText()).toBe('1. B\n  1. b1\n2. C\n3. A\n  1. a1\n    1. x');
		expect((await sourceState('Free.md')).source).toBe(initial);
		await browser.$(`${root} [data-action="apply"]`).click(); await ready('Order applied. Backup:');
		const backupPath = (await browser.$(`${root} .ssm-status`).getText()).split('Backup: ')[1];
		expect(backupPath.endsWith('.md.bak')).toBe(true);
		expect(await browser.executeObsidian(({ app }, p) => app.vault.getMarkdownFiles().some((file) => file.path === p), backupPath)).toBe(false);
		const state = await sourceState('Free.md');
		expect(state.scenes).toEqual(['B', ['b1'], 'C', 'A', ['a1', ['x']]]);
		expect(state.custom).toBe('keep'); expect(state.body).toBe('\n# Manuscript\nBody stays here.\n');
		expect(await browser.executeObsidian(async ({ app }, p) => app.vault.read(app.vault.getFileByPath(p)!), backupPath)).toBe(initial);
	});
	it('disables Apply for an unchanged order and creates no backup', async function () {
		await openIndex('Unchanged.md'); await browser.$(`${root} [data-action="preview"]`).click(); await ready('order is unchanged');
		expect(await browser.$(`${root} [data-action="apply"]`).isEnabled()).toBe(false);
		expect((await sourceState('Unchanged.md')).source).toBe(initial);
		expect(await browser.executeObsidian(({ app }) => app.vault.getFiles().filter((f) => f.path.startsWith('Unchanged.scene-backup-')).length)).toBe(0);
	});
	it('moves a free subtree to another parent with one full source backup', async function () {
		await openIndex('ParentMove.md');
		const values = await browser.$(`${root} [data-field="parent"]`).$$('option').map(async (option) => option.getAttribute('value'));
		expect(values).toEqual(['[]', '[1]', '[1,0]', '[2]']);
		await browser.$(`${root} [data-field="parent"]`).selectByAttribute('value', '[1]');
		await browser.$(`${root} [data-field="position"]`).selectByAttribute('value', '1');
		await browser.$(`${root} [data-action="preview"]`).click(); await ready('in the preview');
		expect(await browser.$(`${root} [data-tree="after"]`).getText()).toBe('1. B\n  1. b1\n  2. A\n    1. a1\n      1. x\n2. C');
		expect((await sourceState('ParentMove.md')).source).toBe(initial);
		await browser.$(`${root} [data-action="apply"]`).click(); await ready('Order applied. Backup:');
		const backupPath = (await browser.$(`${root} .ssm-status`).getText()).split('Backup: ')[1];
		const state = await sourceState('ParentMove.md');
		expect(state.scenes).toEqual(['B', ['b1', 'A', ['a1', ['x']]], 'C']);
		expect(state.custom).toBe('keep'); expect(state.body).toBe('\n# Manuscript\nBody stays here.\n');
		expect(await browser.executeObsidian(async ({ app }, p) => app.vault.read(app.vault.getFileByPath(p)!), backupPath)).toBe(initial);
		expect(await browser.executeObsidian(({ app }) => app.vault.getFiles().filter((f) => f.path.startsWith('ParentMove.scene-backup-')).length)).toBe(1);
	});
	it('keeps an external edit when Apply detects a conflict', async function () {
		await openIndex('Conflict.md'); await stage(2);
		await browser.executeObsidian(async ({ app }) => { await app.vault.process(app.vault.getFileByPath('Conflict.md')!, (text) => text + '\nExternal edit.\n'); });
		await browser.$(`${root} [data-action="apply"]`).click(); await ready('Conflict:');
		expect((await sourceState('Conflict.md')).source).toBe(initial + '\nExternal edit.\n');
	});
	it('refuses invalid trees without changing the source', async function () {
		const invalid = initial.replace('    - A\n', '    - - orphan\n'); await obsidianPage.write('Invalid.md', invalid);
		const result = await browser.executeObsidian(async ({ app }) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, SceneSubtreeMoverPlugin> } }).plugins.plugins['scene-subtree-mover'];
			try { await plugin.readPreview(app.vault.getFileByPath('Invalid.md')!); return ''; } catch (error) { return String(error); }
		});
		expect(result).toContain('child array must follow');
		expect(await browser.executeObsidian(async ({ app }) => app.vault.read(app.vault.getFileByPath('Invalid.md')!))).toBe(invalid);
	});
	it('stops before an index write if the backup fails', async function () {
		await obsidianPage.write('BackupFailure.md', initial);
		const result = await browser.executeObsidian(async ({ app }) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, SceneSubtreeMoverPlugin> } }).plugins.plugins['scene-subtree-mover'];
			const preview = await plugin.readPreview(app.vault.getFileByPath('BackupFailure.md')!);
			preview.after = [preview.before[1], preview.before[2], preview.before[0]];
			const create = app.vault.create;
			app.vault.create = async (): Promise<TFile> => { throw new Error('Test backup failure'); };
			try { await plugin.applyPreview(preview); return 'unexpected success'; } catch (error) { return String(error); } finally { app.vault.create = create; }
		});
		expect(result).toContain('Test backup failure'); expect((await sourceState('BackupFailure.md')).source).toBe(initial);
	});
	it('saves a named order and applies several moves with one backup', async function () {
		await fakeSponsor(); await openIndex('Pro.md'); await stage(2); await stage(1); await ready('2 moves');
		await browser.$(`${root} summary`).click();
		await browser.$(`${root} [data-field="order-name"]`).setValue('Alternative ending');
		await browser.$(`${root} [data-action="save"]`).click(); await ready('Saved order: Alternative ending');
		expect((await sourceState('Pro.md')).source).toBe(initial);
		await browser.$(`${root} [data-action="apply"]`).click(); await ready('Order applied.');
		expect((await sourceState('Pro.md')).scenes).toEqual(['C', 'B', ['b1'], 'A', ['a1', ['x']]]);
		expect(await browser.executeObsidian(({ app }) => app.vault.getFiles().filter((f) => f.path.startsWith('Pro.scene-backup-')).length)).toBe(1);
	});
	it('previews a saved restore and rejects changed parent relationships', async function () {
		await fakeSponsor(); await openIndex('Restore.md'); await browser.$(`${root} summary`).click();
		await browser.$(`${root} [data-field="order-name"]`).setValue('Original order');
		await browser.$(`${root} [data-action="save"]`).click(); await ready('Saved order: Original order');
		await stage(2); await browser.$(`${root} [data-action="apply"]`).click(); await ready('Order applied.'); await browser.keys('Escape');
		await browser.executeObsidianCommand(`${pluginId}:move-chapter`); await browser.$(`${root} [data-field="chapter"]`).waitForExist();
		await browser.$(`${root} summary`).click(); await browser.$(`${root} [data-field="saved-order"]`).selectByAttribute('value', 'Original order');
		await browser.$(`${root} [data-action="restore"]`).click(); await ready('Saved order preview: Original order');
		await browser.$(`${root} [data-action="apply"]`).click(); await ready('Order applied.');
		expect((await sourceState('Restore.md')).scenes).toEqual(['A', ['a1', ['x']], 'B', ['b1'], 'C']);
		const conflict = await browser.executeObsidian(async ({ app }) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, SceneSubtreeMoverPlugin> } }).plugins.plugins['scene-subtree-mover'];
			const preview = await plugin.readPreview(app.vault.getFileByPath('Restore.md')!);
			const saved = plugin.settings.orders.find((o) => o.indexPath === 'Restore.md')!;
			preview.before[1].children!.push(preview.before[0].children![0]); preview.before[0].children = [];
			try { plugin.restoreOrder(saved, preview); return ''; } catch (error) { return String(error); }
		});
		expect(conflict).toContain('different scenes or parent relationships');
	});
});
