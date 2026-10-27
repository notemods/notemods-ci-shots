import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import BasesViewCheckpointsPlugin from '../src/main';
import { bindPro, SPONSORS } from '../src/pro';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import { saveCheckpoint } from '../src/basefile';
import manifest from '../manifest.json';

const START = 'formulas:\n  total: "1"\nviews:\n  - name: Alpha\n    type: table\n    order: [file.name]\n  - name: Beta\n    type: table\n';
async function setup() {
	const app = App.createConfigured__({ files: { 'x.base': START } });
	const plugin = new BasesViewCheckpointsPlugin(app as never, manifest as never);
	await plugin.loadSettings();
	return { app, plugin, file: app.vault.getFileByPath('x.base')! };
}
afterEach(() => { bindPro(null); vi.restoreAllMocks(); });

describe('checkpoint persistence and atomic writes', () => {
	it('loads and repairs settings', async () => {
		const { plugin } = await setup();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ empty: 5 as never })).toEqual(DEFAULT_SETTINGS);
	});
	it('keeps the text before restore and undoes it byte for byte', async () => {
		const { app, plugin, file } = await setup();
		await plugin.save(file as never, 'Alpha');
		const changed = START.replace('"1"', '"2"') + '# Keep this comment\n';
		await app.vault.modify(file, changed);
		await plugin.restoreForFile('x.base', 'Alpha');
		expect(await plugin.undoForFile()).toBe('Checkpoint restore undone.');
		expect(await app.vault.read(file)).toBe(changed);
	});
	it('refuses a stale preview inside the process callback', async () => {
		const { app, plugin, file } = await setup();
		const saved = saveCheckpoint(START, 'x.base', 'Alpha');
		if (!saved.ok) throw new Error(saved.reason);
		await app.vault.modify(file, START + '# Concurrent edit\n');
		await expect(plugin.applyRestore(file as never, saved.checkpoint, START)).rejects.toThrow('changed after the preview');
		expect(await app.vault.read(file)).toBe(START + '# Concurrent edit\n');
		expect(plugin.data.undo).toBeNull();
	});
	it('refuses undo when an edit lands just before the atomic callback', async () => {
		const { app, plugin, file } = await setup();
		await plugin.save(file as never, 'Alpha');
		await plugin.restoreForFile('x.base', 'Alpha');
		const changed = (await app.vault.read(file)) + '# New edit\n';
		const process = app.vault.process.bind(app.vault);
		vi.spyOn(app.vault, 'process').mockImplementationOnce(async (f, fn) => {
			await app.vault.modify(f, changed);
			return process(f, fn);
		});
		expect(await plugin.undoForFile()).toContain('undo was refused');
		expect(await app.vault.read(file)).toBe(changed);
		expect(plugin.data.undo).not.toBeNull();
	});
	it('reloads a saved checkpoint and the undo record', async () => {
		const { plugin } = await setup();
		await plugin.saveForFile('x.base', 'Alpha');
		await plugin.restoreForFile('x.base', 'Alpha');
		const data = structuredClone(plugin.data);
		plugin.data = { free: {}, named: {}, undo: null };
		await plugin.loadSettings();
		expect(plugin.data).toEqual(data);
	});
	it('refuses named save without Pro and keeps the free save available', async () => {
		const { plugin, file } = await setup();
		await plugin.save(file as never, 'Alpha', 'Weekly');
		expect(Object.keys(plugin.data.named)).toHaveLength(0);
		await plugin.save(file as never, 'Alpha');
		expect(Object.keys(plugin.data.free)).toHaveLength(1);
	});
	it('keeps several named checkpoints through Pro and blocks restore after sign out', async () => {
		const { app, plugin, file } = await setup();
		bindPro({ isPro: () => true } as never);
		await plugin.save(file as never, 'Alpha', 'Weekly');
		await plugin.save(file as never, 'Alpha', 'Monthly');
		expect(Object.values(plugin.data.named).map((cp) => cp.label)).toEqual(['Weekly', 'Monthly']);
		const cp = Object.values(plugin.data.named)[0]!;
		await app.vault.modify(file, START + '# Changed\n');
		bindPro(null);
		await plugin.applyRestore(file as never, cp, await app.vault.read(file));
		expect(await app.vault.read(file)).toBe(START + '# Changed\n');
	});
	it('uses the reference GitHub Sponsors terms', () => {
		expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', sponsorLogin: 'theluckystrike', minMonthlyUsd: 5, oneTimeUsd: 15, scope: 'read:user' });
	});
});
