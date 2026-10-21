import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, TFile, TFolder } from 'obsidian-test-mocks/obsidian';
import Plugin from '../src/main';
import { resetPro } from '../src/pro';
import manifest from '../manifest.json';
afterEach(resetPro);
async function start(files: Record<string, string>) {
	const app = App.createConfigured__({ files }); const plugin = new Plugin(app as never, manifest as never);
	// Obsidian moves cached metadata to the new path before plugin handlers run. The mock does not, so emulate it.
	const cache = (app.metadataCache as unknown as { cache__: Map<string, unknown> }).cache__;
	app.vault.on('rename', (_file, oldPath: string) => {
		for (const [path, value] of [...cache]) if (path === oldPath || path.startsWith(oldPath + '/')) { cache.delete(path); cache.set(_file.path + path.slice(oldPath.length), value); }
	});
	await plugin.onload(); app.workspace.setLayoutReady__();
	await vi.waitFor(() => expect(plugin.ready).toBe(true));
	return { app, plugin };
}
async function setStatus(app: App, path: string, status: string): Promise<void> {
	await app.vault.modify(app.vault.getFileByPath(path) as TFile, `---\nstatus: ${status}\n---\nBody\n`);
}
describe('renames with the live event handlers', () => {
	it('records the first change after a note moves into the watched folder', async () => {
		const { app, plugin } = await start({ 'Inbox/A.md': '---\nstatus: draft\n---\nBody\n', 'Notes/B.md': '' });
		await app.vault.rename(app.vault.getFileByPath('Inbox/A.md') as TFile, 'Notes/A.md');
		await setStatus(app, 'Notes/A.md', 'done');
		await vi.waitFor(async () => expect(await plugin.history()).toMatchObject([{ path: 'Notes/A.md', key: 'status', old: { value: 'draft' }, new: { value: 'done' } }]));
	});
	it('follows a rename of the watched folder', async () => {
		const { app, plugin } = await start({ 'Notes/A.md': '---\nstatus: draft\n---\nBody\n' });
		await app.vault.rename(app.vault.getFolderByPath('Notes') as TFolder, 'Projects');
		expect(plugin.settings.folder).toBe('Projects');
		await setStatus(app, 'Projects/A.md', 'done');
		await vi.waitFor(async () => expect(await plugin.history()).toMatchObject([{ path: 'Projects/A.md', key: 'status', old: { value: 'draft' }, new: { value: 'done' } }]));
	});
});
describe('control', () => {
	it('records an in-place change', async () => {
		const { app, plugin } = await start({ 'Notes/A.md': '---\nstatus: draft\n---\nBody\n' });
		await setStatus(app, 'Notes/A.md', 'done');
		await vi.waitFor(async () => expect(await plugin.history()).toHaveLength(1));
	});
});
