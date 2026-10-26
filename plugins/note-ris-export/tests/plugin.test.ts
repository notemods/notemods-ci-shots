import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import NoteRisExportPlugin, { hash } from '../src/main';
import { bindPro, resetPro } from '../src/pro';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import manifest from '../manifest.json';

const LEE = '---\ntype: JOUR\ntitle: Test\nauthors:\n  - Lee\n  - Kim\nyear: 2026\njournal: Example\ndoi: 10.1/test\n---\nBody';
const EXPECTED = 'TY  - JOUR\r\nTI  - Test\r\nAU  - Lee\r\nAU  - Kim\r\nPY  - 2026\r\nT2  - Example\r\nDO  - 10.1/test\r\nER  - \r\n';

async function setup(files: Record<string, string>): Promise<{ app: App; plugin: NoteRisExportPlugin }> {
	const app = App.createConfigured__({ files });
	const plugin = new NoteRisExportPlugin(app as never, manifest as never);
	await plugin.loadSettings();
	return { app, plugin };
}

function pro(on: boolean): void {
	resetPro();
	bindPro({ isPro: () => on, getState: () => ({ status: 'signed-out', lastAttemptAt: 0 }), hasToken: () => false, config: { sponsorLogin: 'theluckystrike' }, onChange: () => () => undefined } as never);
}

async function text(app: App, path: string): Promise<string> {
	return app.vault.read(app.vault.getFileByPath(path)!);
}

afterEach(() => { resetPro(); vi.useRealTimers(); });

describe('NoteRisExportPlugin', () => {
	it('loads with default settings against an in-memory vault', async () => {
		const { plugin } = await setup({ 'notes/a.md': '# Hello world' });
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
	});

	it('repairs bad saved settings', () => {
		expect(normalizeSettings({ folder: 5 as never, output: '  ', map: 'x' as never, maps: 'x' as never, repeat: 'yes' as never, last: 3 as never })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ maps: [{ name: 'Thesis', map: { title: 'paper_title' } as never }], activeMap: 'Thesis' }).maps[0]!.map.title).toBe('paper_title');
		expect(normalizeSettings({ activeMap: 'Gone' }).activeMap).toBe('');
	});

	it('previews the note count of a folder and exports the first acceptance case', async () => {
		const { app, plugin } = await setup({ 'Refs/Lee.md': LEE, 'Other/x.md': 'no' });
		const p = plugin.preview('Refs');
		expect(p.state).toBe('ok');
		expect(p.message).toBe('1 reference note in Refs.');
		expect(p.problems).toEqual([]);
		const path = await plugin.exportRis('Refs');
		expect(path).toBe('References.ris');
		expect(await text(app, 'References.ris')).toBe(EXPECTED);
	});

	it('creates References (2).ris and leaves the old file and the notes unchanged', async () => {
		const { app, plugin } = await setup({ 'Refs/Lee.md': LEE, 'References.ris': 'old' });
		expect(await plugin.exportRis('Refs')).toBe('References (2).ris');
		expect(await text(app, 'References.ris')).toBe('old');
		expect(await text(app, 'Refs/Lee.md')).toBe(LEE);
		expect(await plugin.exportRis('Refs')).toBe('References (3).ris');
	});

	it('stops the export with no file when a note has errors', async () => {
		const { app, plugin } = await setup({ 'Refs/a.md': '---\ntype: JOUR\n---\n', 'Refs/b.md': '---\ntype: JOUR\ntitle: Ok\nyear: soon\n---\n' });
		const p = plugin.preview('Refs');
		expect(p.problems.map((x) => x.path)).toEqual(['Refs/a.md', 'Refs/b.md']);
		expect(await plugin.exportRis('Refs')).toBeNull();
		expect(app.vault.getAbstractFileByPath('References.ris')).toBeNull();
	});

	it('reports an empty folder, a missing folder and a cache that is not ready', async () => {
		const { app, plugin } = await setup({ 'Refs/a.md': LEE, 'Empty/x.txt': 'x' });
		expect(plugin.preview('Empty').state).toBe('empty');
		expect(plugin.preview('Nope').message).toBe('Folder Nope does not exist.');
		const spy = vi.spyOn(app.metadataCache, 'getFileCache').mockReturnValue(null);
		const p = plugin.preview('Refs');
		expect(p.state).toBe('not-ready');
		expect(p.message).toContain('not ready for 1 of 1 notes in Refs');
		expect(await plugin.exportRis('Refs')).toBeNull();
		expect(app.vault.getAbstractFileByPath('References.ris')).toBeNull();
		spy.mockRestore();
	});

	it('uses the vault root when the folder is empty', async () => {
		const { plugin } = await setup({ 'Refs/a.md': LEE, 'b.md': LEE });
		expect(plugin.preview('').message).toBe('2 reference notes in the vault root.');
	});

	it('does not write when the output folder does not exist', async () => {
		const { app, plugin } = await setup({ 'Refs/a.md': LEE });
		plugin.settings.output = 'Exports/Thesis.ris';
		expect(await plugin.exportRis('Refs')).toBeNull();
		await app.vault.createFolder('Exports');
		expect(await plugin.exportRis('Refs')).toBe('Exports/Thesis.ris');
	});

	it('uses a mapped property key', async () => {
		const { app, plugin } = await setup({ 'Refs/a.md': '---\ntype: JOUR\npaper_title: A study\n---\n' });
		plugin.settings.map = { ...plugin.settings.map, title: 'paper_title' };
		expect(await plugin.exportRis('Refs')).toBe('References.ris');
		expect(await text(app, 'References.ris')).toBe('TY  - JOUR\r\nTI  - A study\r\nER  - \r\n');
	});
});

describe('Pro features', () => {
	const files = {
		'Refs/a.md': '---\ntype: JOUR\ntitle: A\ncollection: thesis\n---\n',
		'Refs/b.md': '---\ntype: BOOK\ntitle: B\ncollection: [review]\n---\n',
		'Refs/c.md': '---\ntype: CONF\nname: C\ncollection: [conference]\n---\n',
	};

	it('without Pro, maps, filter and repeat do nothing', async () => {
		pro(false);
		const { app, plugin } = await setup(files);
		expect(await plugin.saveMap('Thesis')).toBe(false);
		expect(await plugin.useMap('Thesis')).toBe(false);
		expect(await plugin.setRepeat(true)).toBe(false);
		expect(await plugin.repeatLast()).toBe('blocked');
		// The filter has no effect without Pro: c.md has no title, so the full folder has an error.
		expect(plugin.preview('Refs', 'collection = conference').problems.map((p) => p.path)).toEqual(['Refs/c.md']);
		expect(plugin.settings.maps).toEqual([]);
		expect(app.vault.getAbstractFileByPath('References.ris')).toBeNull();
	});

	it('exports a filtered group with a named field map', async () => {
		pro(true);
		const { app, plugin } = await setup(files);
		const p = plugin.preview('Refs', 'collection = review');
		expect(p.message).toBe('1 of 3 reference notes in Refs match collection = review.');
		expect(plugin.preview('Refs', 'collection=nothing').state).toBe('no-match');
		// Case matters: Thesis does not match thesis.
		expect(plugin.preview('Refs', 'collection = Thesis').state).toBe('no-match');
		expect(plugin.preview('Refs', 'thesis').state).toBe('bad-filter');
		expect(await plugin.exportRis('Refs', 'collection = thesis')).toBe('References.ris');
		expect(await text(app, 'References.ris')).toBe('TY  - JOUR\r\nTI  - A\r\nER  - \r\n');
		// c.md keeps its title in "name". A named map selects it for the conference group only.
		expect(plugin.preview('Refs', 'collection = conference').problems.map((x) => x.path)).toEqual(['Refs/c.md']);
		plugin.settings.map = { ...plugin.settings.map, title: 'name' };
		expect(await plugin.saveMap('Conference')).toBe(true);
		plugin.settings.map = { ...plugin.settings.map, title: 'title' };
		expect(await plugin.useMap('Conference')).toBe(true);
		expect(await plugin.exportRis('Refs', 'collection = conference')).toBe('References (2).ris');
		expect(await text(app, 'References (2).ris')).toBe('TY  - CONF\r\nTI  - C\r\nER  - \r\n');
		expect(plugin.settings.maps.map((m) => m.name)).toEqual(['Conference']);
		await plugin.deleteMap('Conference');
		expect(plugin.settings.activeMap).toBe('');
	});

	it('repeats the last export into its own unchanged file, else into a new file', async () => {
		pro(true);
		const { app, plugin } = await setup({ 'Refs/a.md': LEE });
		expect(await plugin.repeatLast()).toBe('none');
		expect(await plugin.exportRis('Refs')).toBe('References.ris');
		expect(plugin.settings.last?.hash).toBe(hash(EXPECTED));
		expect(await plugin.repeatLast()).toBe('unchanged');
		const f = app.vault.getFileByPath('Refs/a.md')!;
		await app.vault.modify(f, LEE.replace('title: Test', 'title: Test two'));
		expect(await plugin.repeatLast()).toBe('updated');
		expect(await text(app, 'References.ris')).toContain('TI  - Test two\r\n');
		await app.vault.modify(app.vault.getFileByPath('References.ris')!, 'my edit');
		await app.vault.modify(f, LEE);
		expect(await plugin.repeatLast()).toBe('new');
		expect(await text(app, 'References.ris')).toBe('my edit');
		expect(await text(app, 'References (2).ris')).toBe(EXPECTED);
	});
	it('waits two seconds after the last change and cancels the timer on unload', async () => {
		vi.useFakeTimers();
		const { app, plugin } = await setup({ 'Refs/a.md': LEE, 'Other/a.md': LEE });
		await plugin.onload();
		pro(true);
		await plugin.exportRis('Refs');
		await plugin.setRepeat(true);
		const f = app.vault.getFileByPath('Refs/a.md')!;
		await app.vault.modify(f, LEE.replace('title: Test', 'title: First edit'));
		await vi.advanceTimersByTimeAsync(1999);
		expect(await text(app, 'References.ris')).toBe(EXPECTED);
		await app.vault.modify(f, LEE.replace('title: Test', 'title: Last edit'));
		await vi.advanceTimersByTimeAsync(1999);
		expect(await text(app, 'References.ris')).toBe(EXPECTED);
		await vi.advanceTimersByTimeAsync(1);
		expect(await text(app, 'References.ris')).toContain('TI  - Last edit\r\n');
		await app.vault.modify(f, LEE);
		plugin.onunload();
		await vi.advanceTimersByTimeAsync(2000);
		expect(await text(app, 'References.ris')).toContain('TI  - Last edit\r\n');
	});

	it('updates its own file in one Vault.process call, not a read then a modify', async () => {
		pro(true);
		const { app, plugin } = await setup({ 'Refs/a.md': LEE });
		await plugin.exportRis('Refs');
		await app.vault.modify(app.vault.getFileByPath('Refs/a.md')!, LEE.replace('title: Test', 'title: Test two'));
		const modify = vi.spyOn(app.vault, 'modify');
		const process = vi.spyOn(app.vault, 'process');
		expect(await plugin.repeatLast()).toBe('updated');
		expect(modify).not.toHaveBeenCalled();
		expect(process).toHaveBeenCalledTimes(1);
		expect(await text(app, 'References.ris')).toContain('TI  - Test two\r\n');
	});

	it('does not write a duplicate file when two repeats run at the same time', async () => {
		pro(true);
		const { app, plugin } = await setup({ 'Refs/a.md': LEE });
		await plugin.exportRis('Refs');
		await app.vault.modify(app.vault.getFileByPath('Refs/a.md')!, LEE.replace('title: Test', 'title: Test two'));
		expect(await Promise.all([plugin.repeatLast(), plugin.repeatLast()])).toEqual(['updated', 'unchanged']);
		expect(app.vault.getAbstractFileByPath('References (2).ris')).toBeNull();
	});

	it('does not write when the repeat setting goes off before the delay ends', async () => {
		vi.useFakeTimers();
		const { app, plugin } = await setup({ 'Refs/a.md': LEE });
		await plugin.onload();
		pro(true);
		await plugin.exportRis('Refs');
		await plugin.setRepeat(true);
		await app.vault.modify(app.vault.getFileByPath('Refs/a.md')!, LEE.replace('title: Test', 'title: Changed'));
		await vi.advanceTimersByTimeAsync(500);
		await plugin.setRepeat(false);
		await vi.advanceTimersByTimeAsync(2000);
		expect(await text(app, 'References.ris')).toBe(EXPECTED);
		plugin.onunload();
	});

	it('creates a new repeat file after the last file was deleted', async () => {
		pro(true);
		const { app, plugin } = await setup({ 'Refs/a.md': LEE });
		await plugin.exportRis('Refs');
		await app.vault.delete(app.vault.getFileByPath('References.ris')!);
		expect(await plugin.repeatLast()).toBe('new');
		expect(await text(app, 'References.ris')).toBe(EXPECTED);
	});

});
