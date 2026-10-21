import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import WordCountPropertyPlugin from '../src/main';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import manifest from '../manifest.json';

const sponsors = vi.hoisted(() => ({
	init: vi.fn(), refresh: vi.fn(), isPro: vi.fn(() => false),
	onChange: vi.fn((_cb: () => void) => () => undefined),
}));
vi.mock('../src/license/github-obsidian', () => ({ createGitHubSponsors: () => sponsors, fillAccountSetting: vi.fn() }));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); sponsors.isPro.mockReturnValue(false); });

function makePlugin() {
	const app = App.createConfigured__({ files: { 'notes/a.md': '# Hello world' } });
	return { app, plugin: new WordCountPropertyPlugin(app as never, manifest as never) };
}

describe('settings', () => {
	it('loads rendered-text and code-block settings as off by default', () => {
		expect(DEFAULT_SETTINGS).toEqual({ countRenderedText: false, includeCodeBlocks: false });
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
	});

	it('repairs invalid saved values one field at a time', () => {
		expect(normalizeSettings({ countRenderedText: 'yes' as never, includeCodeBlocks: true })).toEqual({
			countRenderedText: false,
			includeCodeBlocks: true,
		});
		expect(normalizeSettings({ countRenderedText: true, includeCodeBlocks: 1 as never })).toEqual({
			countRenderedText: true,
			includeCodeBlocks: false,
		});
	});

	it('loads defaults from an in-memory vault', async () => {
		const { plugin } = makePlugin();
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
	});
});

describe('per-note tracking command', () => {
	it('adds numeric word and reading-time properties when a note opts in', async () => {
		const { app, plugin } = makePlugin();
		await plugin.loadSettings();
		const file = app.vault.getFileByPath('notes/a.md');
		if (!file) throw new Error('test note is missing');
		expect(await plugin.toggleTracking(file)).toBe('enabled');
		const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
		expect(frontmatter?.wordCountTracked).toBe(true);
		expect(frontmatter?.wordCount).toBe(2);
		expect(frontmatter?.readingTimeMinutes).toBe(1);
		expect(typeof frontmatter?.wordCount).toBe('number');
		expect(typeof frontmatter?.readingTimeMinutes).toBe('number');
	});

	it('does not replace existing count properties', async () => {
		const app = App.createConfigured__({ files: { 'notes/a.md': '---\nwordCount: 99\n---\nBody' } });
		const plugin = new WordCountPropertyPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		const file = app.vault.getFileByPath('notes/a.md');
		if (!file) throw new Error('test note is missing');
		expect(await plugin.toggleTracking(file)).toBe('conflict');
		expect(app.metadataCache.getFileCache(file)?.frontmatter?.wordCount).toBe(99);
		expect(app.metadataCache.getFileCache(file)?.frontmatter?.wordCountTracked).toBeUndefined();
	});

	it('leaves an untracked note unchanged when count logic runs', async () => {
		const { app, plugin } = makePlugin();
		await plugin.loadSettings();
		const file = app.vault.getFileByPath('notes/a.md');
		if (!file) throw new Error('test note is missing');
		const internals = plugin as unknown as { refreshTrackedFile(file: typeof file): Promise<void> };
		await internals.refreshTrackedFile(file);
		expect(await app.vault.read(file)).toBe('# Hello world');
		expect(app.metadataCache.getFileCache(file)?.frontmatter?.wordCount).toBeUndefined();
	});

	it('removes its marker and output properties when tracking stops', async () => {
		const { app, plugin } = makePlugin();
		await plugin.loadSettings();
		const file = app.vault.getFileByPath('notes/a.md');
		if (!file) throw new Error('test note is missing');
		await plugin.toggleTracking(file);
		expect(await plugin.toggleTracking(file)).toBe('disabled');
		const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
		expect(frontmatter?.wordCountTracked).toBeUndefined();
		expect(frontmatter?.wordCount).toBeUndefined();
		expect(frontmatter?.readingTimeMinutes).toBeUndefined();
	});

	it('updates an opted-in note after its body changes', async () => {
		const app = App.createConfigured__({ files: { 'notes/a.md': '---\nwordCountTracked: true\n---\nOne two' } });
		const plugin = new WordCountPropertyPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		const file = app.vault.getFileByPath('notes/a.md');
		if (!file) throw new Error('test note is missing');
		const internals = plugin as unknown as { refreshTrackedFile(file: typeof file, checkCache?: boolean): Promise<void> };
		await internals.refreshTrackedFile(file);
		await app.vault.modify(file, '---\nwordCountTracked: true\n---\nOne two three four');
		await internals.refreshTrackedFile(file);
		const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
		expect(frontmatter?.wordCount).toBe(4);
		expect(await app.vault.read(file)).toContain('One two three four');
	});
});


// Drive actual workspace and metadata event handlers, rather than only helper functions.
describe('refresh lifecycle', () => {
	async function loaded() {
		const { app, plugin } = makePlugin();
		await plugin.onload();
		const file = app.vault.getFileByPath('notes/a.md');
		if (!file) throw new Error('test note missing');
		await plugin.toggleTracking(file);
		return { app, plugin, file };
	}

	it('converges after its own metadata change without another write', async () => {
		vi.useFakeTimers();
		const { app, plugin, file } = await loaded();
		const write = vi.spyOn(app.fileManager, 'processFrontMatter');
		app.metadataCache.trigger('changed', file);
		await vi.advanceTimersByTimeAsync(6000);
		expect(write).not.toHaveBeenCalled();
		plugin.onunload();
	});

	it('waits for five seconds after the last editor change, including repeated autosaves', async () => {
		vi.useFakeTimers();
		const { app, plugin, file } = await loaded();
		await app.vault.append(file, ' three');
		const write = vi.spyOn(app.fileManager, 'processFrontMatter');
		app.workspace.trigger('editor-change', {}, { file });
		await vi.advanceTimersByTimeAsync(4000);
		app.workspace.trigger('editor-change', {}, { file });
		app.metadataCache.trigger('changed', file);
		await vi.advanceTimersByTimeAsync(4999);
		expect(write).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(write).toHaveBeenCalledTimes(1);
		expect(app.metadataCache.getFileCache(file)?.frontmatter?.wordCount).toBe(3);
		plugin.onunload();
	});

	it('flushes the previous note when the active file closes', async () => {
		vi.useFakeTimers();
		const { app, plugin, file } = await loaded();
		// The mock workspace has no real leaf; model its active file through the public getter.
		vi.spyOn(app.workspace, 'getActiveFile').mockReturnValue(file);
		app.workspace.trigger('file-open', file);
		await app.vault.append(file, ' three');
		app.workspace.trigger('editor-change', {}, { file });
		vi.spyOn(app.workspace, 'getActiveFile').mockReturnValue(null);
		app.workspace.trigger('file-open', null);
		await vi.advanceTimersByTimeAsync(0);
		expect(app.metadataCache.getFileCache(file)?.frontmatter?.wordCount).toBe(3);
		plugin.onunload();
	});

	it('two devices with different Pro preview settings keep the same stored count', async () => {
		const { app, plugin, file } = await loaded();
		await app.vault.append(file, ' [visible](https://example.com/hidden)');
		const second = new WordCountPropertyPlugin(app as never, manifest as never);
		second.pro = { isPro: () => true } as never;
		second.settings = { countRenderedText: true, includeCodeBlocks: false };
		type Refresh = { refreshTrackedFile(f: typeof file): Promise<void> };
		await (second as unknown as Refresh).refreshTrackedFile(file);
		const count = app.metadataCache.getFileCache(file)?.frontmatter?.wordCount;
		const write = vi.spyOn(app.fileManager, 'processFrontMatter');
		await (plugin as unknown as Refresh).refreshTrackedFile(file);
		await (second as unknown as Refresh).refreshTrackedFile(file);
		expect(write).not.toHaveBeenCalled();
		expect(app.metadataCache.getFileCache(file)?.frontmatter?.wordCount).toBe(count);
		plugin.onunload(); second.onunload();
	});

	it('does not recount on Pro changes or preview setting changes', async () => {
		const { app, plugin } = await loaded();
		const write = vi.spyOn(app.fileManager, 'processFrontMatter');
		sponsors.isPro.mockReturnValue(true);
		sponsors.onChange.mock.calls.at(-1)?.[0]();
		await plugin.setRenderedText(true);
		await plugin.setCodeBlocks(true);
		sponsors.isPro.mockReturnValue(false);
		sponsors.onChange.mock.calls.at(-1)?.[0]();
		expect(write).not.toHaveBeenCalled();
		plugin.onunload();
	});

	it('refuses foreign properties beside a hand-added opt-in marker on refresh', async () => {
		const { app, plugin, file } = await loaded();
		await app.vault.modify(file, '---\nwordCountTracked: true\nwordCount: 500\nreadingTimeMinutes: 7\n---\nOne two');
		const write = vi.spyOn(app.fileManager, 'processFrontMatter');
		await (plugin as unknown as { refreshTrackedFile(f: typeof file): Promise<void> }).refreshTrackedFile(file);
		expect(write).not.toHaveBeenCalled();
		expect(app.metadataCache.getFileCache(file)?.frontmatter?.wordCount).toBe(500);
		plugin.onunload();
	});

	it('stops an in-progress startup scan after unload and cancels timers', async () => {
		vi.useFakeTimers();
		const { app, plugin, file } = await loaded();
		app.metadataCache.trigger('changed', file);
		const original = app.vault.read.bind(app.vault);
		vi.spyOn(app.vault, 'read').mockImplementation(async (f) => {
			const text = await original(f);
			plugin.onunload();
			return text + ' three';
		});
		const write = vi.spyOn(app.fileManager, 'processFrontMatter');
		await (plugin as unknown as { refreshTrackedNotes(): Promise<void> }).refreshTrackedNotes();
		await vi.advanceTimersByTimeAsync(10000);
		expect(write).not.toHaveBeenCalled();
	});
});
