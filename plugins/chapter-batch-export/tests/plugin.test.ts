import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import { getFrontMatterInfo, parseYaml } from 'obsidian';
import Plugin from '../src/main';
import { DEFAULT_OPTIONS } from '../src/core';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import { bindPro, isPro, onProChange, resetPro, SPONSORS } from '../src/pro';
import manifest from '../manifest.json';
vi.mock('obsidian', async (importOriginal) => ({
	...await importOriginal<Record<string, unknown>>(),
	getFrontMatterInfo: vi.fn(() => ({ exists: true, frontmatter: 'test index' })),
	parseYaml: vi.fn(() => ({ longform: { format: 'scenes', sceneFolder: '/', scenes: ['One', ['Child'], 'Two'] } })),
}));
afterEach(() => { resetPro(); vi.restoreAllMocks(); });
function setup(extra: Record<string, string> = {}) {
	const app = App.createConfigured__({ files: { 'Book/Index.md': '---\nlongform: test\n---\n', 'Book/One.md': '---\ntags: source\n---\nFirst.', 'Book/Child.md': 'Child.', 'Book/Two.md': 'Second.', ...extra } });
	const plugin = new Plugin(app as never, manifest as never);
	return { app, plugin, opts: { ...DEFAULT_OPTIONS, folder: 'Exports' } };
}
function manager(active: boolean) { return { isPro: () => active, onChange: () => () => undefined }; }
describe('vault export', () => {
	it('loads default settings', async () => { const { plugin } = setup(); await plugin.loadSettings(); expect(plugin.settings).toEqual(DEFAULT_SETTINGS); });
	it('creates joined chapters and a linked index without changing sources', async () => {
		const { app, plugin, opts } = setup(); const preview = await plugin.prepare('Book/Index.md', opts);
		await plugin.exportPreview(preview);
		expect(await app.vault.read(app.vault.getFileByPath('Exports/01 One.md')!)).toBe('# One\n\nFirst.\n\nChild.\n');
		expect(await app.vault.read(app.vault.getFileByPath('Exports/02 Two.md')!)).toBe('# Two\n\nSecond.\n');
		const index = await app.vault.read(app.vault.getFileByPath('Exports/_index.md')!);
		expect(index).toContain('[[Book/Child.md]]'); expect(index).toContain('[[Exports/02 Two.md]]');
		expect(await app.vault.read(app.vault.getFileByPath('Book/One.md')!)).toBe('---\ntags: source\n---\nFirst.');
	});
	it('stops before folder creation when a source is missing', async () => {
		const { app, plugin, opts } = setup(); await app.vault.delete(app.vault.getFileByPath('Book/Child.md')!);
		const preview = await plugin.prepare('Book/Index.md', opts); expect(preview.plan.missing).toEqual(['Book/Child.md']);
		await expect(plugin.exportPreview(preview)).rejects.toThrow('missing scene'); expect(app.vault.getAbstractFileByPath('Exports')).toBeNull();
	});
	it('refuses an existing folder without replacing its content', async () => {
		const { app, plugin, opts } = setup({ 'Exports/01 One.md': 'Keep me' });
		await expect(plugin.exportPreview(await plugin.prepare('Book/Index.md', opts))).rejects.toThrow('folder exists');
		expect(await app.vault.read(app.vault.getFileByPath('Exports/01 One.md')!)).toBe('Keep me');
	});
	it('refuses an absent parent folder without a write', async () => {
		const { app, plugin, opts } = setup(); opts.folder = 'Absent/New';
		await expect(plugin.exportPreview(await plugin.prepare('Book/Index.md', opts))).rejects.toThrow('parent output folder'); expect(app.vault.getAbstractFileByPath('Absent')).toBeNull();
	});
	it('rejects a stale preview after a source edit', async () => {
		const { app, plugin, opts } = setup(); const preview = await plugin.prepare('Book/Index.md', opts);
		await app.vault.modify(app.vault.getFileByPath('Book/Child.md')!, 'Changed.');
		await expect(plugin.exportPreview(preview)).rejects.toThrow('Make a new preview'); expect(app.vault.getAbstractFileByPath('Exports')).toBeNull();
	});
	it('rejects a stale preview after the index order changes', async () => {
		const { app, plugin, opts } = setup(); const preview = await plugin.prepare('Book/Index.md', opts);
		vi.mocked(parseYaml).mockReturnValueOnce({ longform: { format: 'scenes', sceneFolder: '/', scenes: ['Two', 'One', ['Child']] } });
		await expect(plugin.exportPreview(preview)).rejects.toThrow('Make a new preview'); expect(app.vault.getAbstractFileByPath('Exports')).toBeNull();
	});
	it('reports an incomplete folder on a disk write failure and does not write the index', async () => {
		const { app, plugin, opts } = setup(); const preview = await plugin.prepare('Book/Index.md', opts);
		vi.spyOn(app.vault, 'create').mockRejectedValueOnce(new Error('Disk full'));
		await expect(plugin.exportPreview(preview)).rejects.toThrow('incomplete in Exports');
		expect(app.vault.getAbstractFileByPath('Exports')).not.toBeNull(); expect(app.vault.getAbstractFileByPath('Exports/_index.md')).toBeNull();
	});
	it('free export ignores range and custom format data', async () => {
		const { plugin, opts } = setup(); opts.range = '2'; opts.filename = 'Paid {number}';
		const preview = await plugin.prepare('Book/Index.md', opts); expect(preview.plan.chapters.map((c) => c.filename)).toEqual(['01 One.md', '02 Two.md']);
	});
	it('Pro selects a range and does not block on an unselected missing scene', async () => {
		const { app, plugin, opts } = setup(); bindPro(manager(true) as never); opts.range = '2'; opts.filename = 'Paid {number}';
		await app.vault.delete(app.vault.getFileByPath('Book/Child.md')!);
		const preview = await plugin.prepare('Book/Index.md', opts); expect(preview.plan.missing).toEqual([]); await plugin.exportPreview(preview);
		expect(app.vault.getFileByPath('Exports/Paid 02.md')).not.toBeNull(); expect(app.vault.getFileByPath('Exports/01 One.md')).toBeNull();
	});
	it('Pro loss between preview and save blocks the write', async () => {
		const { app, plugin, opts } = setup(); bindPro(manager(true) as never); opts.range = '2'; const preview = await plugin.prepare('Book/Index.md', opts);
		resetPro(); await expect(plugin.exportPreview(preview)).rejects.toThrow('Make a new preview'); expect(app.vault.getAbstractFileByPath('Exports')).toBeNull();
	});
	it('refuses an index without frontmatter', async () => {
		vi.mocked(getFrontMatterInfo).mockReturnValueOnce({ exists: false, frontmatter: '', from: 0, to: 0, contentStart: 0 });
		const { plugin } = setup(); await expect(plugin.prepare('Book/Index.md')).rejects.toThrow('initial Longform frontmatter');
	});
});
describe('presets and Pro', () => {
	it('refuses a preset without Pro', async () => { const { plugin, opts } = setup(); await expect(plugin.savePreset('Draft', opts)).rejects.toThrow('need Pro'); expect(plugin.settings.presets).toEqual([]); });
	it('saves and replaces a named preset with Pro', async () => {
		const { plugin, opts } = setup(); bindPro(manager(true) as never); await plugin.savePreset('Draft', opts); await plugin.savePreset('Draft', { ...opts, heading: '' });
		expect(plugin.settings.presets).toEqual([{ name: 'Draft', ...opts, heading: '' }]);
	});
	it('repairs bad saved settings', () => {
		expect(normalizeSettings({ outputFolder: 5 as never, presets: [null as never, { name: 'bad' } as never] })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
	});
	it('uses the reference sponsor values and clears listeners on reset', () => {
		expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', minMonthlyUsd: 5, oneTimeUsd: 15, oneTimeMonths: 0, sponsorLogin: 'theluckystrike' });
		const cb = vi.fn(); onProChange(cb); bindPro(manager(true) as never); expect(isPro()).toBe(true); resetPro(); expect(isPro()).toBe(false);
	});
});
