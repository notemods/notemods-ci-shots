import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import CraftLinkRepairPlugin from '../src/main';
import { DEFAULT_SETTINGS, normalizeSettings, CraftLinkRepairSettingTab } from '../src/settings';
import { SPONSORS, bindPro, isPro, onProChange, resetPro } from '../src/pro';
import manifest from '../manifest.json';

const page = 'Export/Page.textbundle/text.md';
const info = 'Export/Page.textbundle/info.json';
const text = '# Project\n[Project](craftdocs://open?documentId=page)\n[Monday](day://2026-10-12)\n[Lost](craftdocs://open?documentId=lost)';
function setup(files: Record<string, string> = { [page]: text, [info]: '{"identifier":"page"}' }) {
	const app = App.createConfigured__({ files });
	const plugin = new CraftLinkRepairPlugin(app as never, manifest as never);
	return { app, plugin };
}
function fakePro(value: boolean) {
	let pro = value;
	const listeners = new Set<() => void>();
	const manager = { isPro: () => pro, onChange: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); } };
	bindPro(manager as never);
	return { set: (value: boolean) => { pro = value; for (const fn of listeners) fn(); }, listeners };
}
afterEach(() => { resetPro(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('settings and Pro', () => {
	it('loads defaults', async () => { const { plugin } = setup(); await plugin.loadSettings(); expect(plugin.settings).toEqual(DEFAULT_SETTINGS); expect(isPro()).toBe(false); });
	it('repairs invalid settings', () => {
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ folder: 7, automatic: 'yes', dateFormat: 'bad', dateFolder: [] })).toEqual(DEFAULT_SETTINGS);
	});
	it('rejects saved Pro choices from the free UI', async () => {
		const { app, plugin } = setup();
		const tab = new CraftLinkRepairSettingTab(app as never, plugin);
		await tab.setControlValue('outputFolder', 'Copies');
		await tab.setControlValue('automatic', true);
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		await tab.setControlValue('folder', 'Export');
		expect(plugin.settings.folder).toBe('Export');
	});
	it('facade follows sign out and removes listeners', () => {
		const manager = fakePro(true); const fn = vi.fn(); const off = onProChange(fn);
		manager.set(false); expect(isPro()).toBe(false); expect(fn).toHaveBeenCalledTimes(1);
		off(); manager.set(true); expect(fn).toHaveBeenCalledTimes(1);
		resetPro(); expect(manager.listeners.size).toBe(0);
	});
	it('uses the reference sponsor terms', () => expect(SPONSORS).toEqual({ clientId: 'Ov23lic5UPGPZqhBlBGg', sponsorLogin: 'theluckystrike', minMonthlyUsd: 5, oneTimeUsd: 15, oneTimeMonths: 0, scope: 'read:user' }));
});
describe('local vault writes', () => {
	it('writes copies and a report while sources stay intact', async () => {
		const { app, plugin } = setup();
		const plan = await plugin.prepare('Export');
		expect(app.vault.getFiles()).toHaveLength(2);
		const result = await plugin.writePlan(plan);
		expect(result.failures).toEqual([]);
		expect(result.written).toEqual(['Export/Page.textbundle/text.repaired.md']);
		expect(await app.vault.read(app.vault.getFileByPath(page)!)).toBe(text);
		const copied = await app.vault.read(app.vault.getFileByPath(result.written[0]!)!);
		expect(copied).toContain('[[Export/Page.textbundle/text.repaired|Project]]');
		expect(copied).toContain('[[2026-10-12|Monday]]');
		expect(copied).toContain('craftdocs://open?documentId=lost');
		expect(await app.vault.read(app.vault.getFileByPath(result.report)!)).toContain('Missing or ambiguous page identifier');
		const again = await plugin.prepare('Export');
		expect(again.copies).toEqual([]); expect(again.skipped).toEqual([page]);
	});
	it('rejects a source changed after preview before writing', async () => {
		const { app, plugin } = setup(); const plan = await plugin.prepare('Export');
		await app.vault.modify(app.vault.getFileByPath(page)!, 'Changed');
		await expect(plugin.writePlan(plan)).rejects.toThrow('Preview again');
		expect(app.vault.getFiles()).toHaveLength(2);
	});
	it('rejects a new output collision after preview', async () => {
		const { app, plugin } = setup(); const plan = await plugin.prepare('Export');
		await app.vault.create('Export/Page.textbundle/text.repaired.md', 'Keep me');
		await expect(plugin.writePlan(plan)).rejects.toThrow('Preview again');
		expect(await app.vault.read(app.vault.getFileByPath('Export/Page.textbundle/text.repaired.md')!)).toBe('Keep me');
	});
	it('blocks a free pass of 11 notes before writing', async () => {
		const files = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`Export/${i}.md`, 'note']));
		const { app, plugin } = setup(files); const plan = await plugin.prepare('Export');
		await expect(plugin.writePlan(plan)).rejects.toThrow('Free limit'); expect(app.vault.getFiles()).toHaveLength(11);
	});
	it('rechecks Pro when writing an unlimited preview', async () => {
		const files = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`Export/${i}.md`, 'note']));
		const { app, plugin } = setup(files); const pro = fakePro(true); const plan = await plugin.prepare('Export');
		expect(plan.blocked).toEqual([]); pro.set(false);
		await expect(plugin.writePlan(plan)).rejects.toThrow('Preview again'); expect(app.vault.getFiles()).toHaveLength(11);
	});
	it('creates a separate output tree for Pro and rebases resources', async () => {
		fakePro(true); const { app, plugin } = setup({ [page]: text+'\n![Image](assets/image.png)', [info]: '{"identifier":"page"}' });
		plugin.settings.outputFolder = 'Copies'; plugin.settings.dateFolder = 'Daily'; plugin.settings.dateFormat = 'YYYY.MM.DD';
		const result = await plugin.writePlan(await plugin.prepare('Export'));
		expect(result.written).toEqual(['Copies/Page.textbundle/text.md']);
		const copied = await app.vault.read(app.vault.getFileByPath(result.written[0]!)!);
		expect(copied).toContain('[[Copies/Page.textbundle/text|Project]]');
		expect(copied).toContain('[[Daily/2026.10.12|Monday]]');
		expect(copied).toContain('../../Export/Page.textbundle/assets/image.png');
	});
	it('blocks a file at an output parent before writing', async () => {
		fakePro(true); const { plugin } = setup({ [page]: text, [info]: '{"identifier":"page"}', 'Copies/Page.textbundle': 'Keep this file' }); plugin.settings.outputFolder = 'Copies';
		expect((await plugin.prepare('Export')).blocked).toContain('A file blocks the output folder: Copies/Page.textbundle');
	});
	it('records partial write failure and keeps original notes', async () => {
		const { app, plugin } = setup({ 'Export/A.md': 'a', 'Export/B.md': 'b' });
		const originalCreate = app.vault.create.bind(app.vault);
		vi.spyOn(app.vault, 'create').mockImplementation(async (path, content) => { if (path === 'Export/B.repaired.md') throw new Error('disk failure'); return originalCreate(path, content); });
		const result = await plugin.writePlan(await plugin.prepare('Export'));
		expect(result.written).toEqual(['Export/A.repaired.md']); expect(result.failures).toHaveLength(1);
		expect(await app.vault.read(app.vault.getFileByPath('Export/A.md')!)).toBe('a');
		expect(await app.vault.read(app.vault.getFileByPath(result.report)!)).toContain('disk failure');
	});
	it('rejects another write pass while the first pass runs', async () => {
		const { plugin } = setup(); const plan = await plugin.prepare('Export'); const first = plugin.writePlan(plan);
		await expect(plugin.writePlan(plan)).rejects.toThrow('in progress'); await first;
	});
	it('restores saved copy records after reload', async () => {
		const { app, plugin } = setup(); await plugin.writePlan(await plugin.prepare('Export'));
		const reloaded = new CraftLinkRepairPlugin(app as never, manifest as never);
		vi.spyOn(reloaded, 'loadData').mockResolvedValue({ ...plugin.settings, receipts: plugin.receipts });
		await reloaded.loadSettings(); expect((await reloaded.prepare('Export')).skipped).toEqual([page]);
	});
});
describe('automatic pass', () => {
	it('is inactive without Pro even with the saved toggle on', async () => {
		const { app, plugin } = setup(); await plugin.onload(); plugin.settings.automatic = true; plugin.settings.folder = 'Export';
		expect(await plugin.runAutomatic()).toBeNull(); expect(app.vault.getFiles()).toHaveLength(2); plugin.onunload();
	});
	it('writes new copies with Pro and waits for missing metadata', async () => {
		const { app, plugin } = setup(); await plugin.onload(); fakePro(true); plugin.settings.automatic = true; plugin.settings.folder = 'Export';
		const result = await plugin.runAutomatic(); expect(result?.written).toHaveLength(1);
		await app.vault.createFolder('Export/New.textbundle'); await app.vault.create('Export/New.textbundle/text.md', 'New page');
		expect(await plugin.runAutomatic()).toBeNull();
		await app.vault.create('Export/New.textbundle/info.json', '{"identifier":"new"}');
		expect((await plugin.runAutomatic())?.written).toEqual(['Export/New.textbundle/text.repaired.md']);
		plugin.onunload();
	});
	it('stops automatic work on unload', async () => {
		const { plugin } = setup(); await plugin.onload(); fakePro(true); plugin.settings.automatic = true; plugin.settings.folder = 'Export';
		plugin.onunload(); expect(await plugin.runAutomatic()).toBeNull();
	});
});
