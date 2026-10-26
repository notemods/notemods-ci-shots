import { describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import SteadyInlineMathPlugin from '../src/main';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import manifest from '../manifest.json';

describe('SteadyInlineMathPlugin', () => {
	it('loads with default settings against an in-memory vault', async () => {
		const app = App.createConfigured__({ files: { 'notes/a.md': '# Hello world' } });
		const plugin = new SteadyInlineMathPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
	});

	it('repairs bad saved settings', () => {
		expect(normalizeSettings({ enabled: 5 as never, folderRules: 8 as never })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
	});

	it('restores the clean source of a closed tab only when the file holds the guarded source', async () => {
		const app = App.createConfigured__({ files: { 'a.md': 'A ${} x{}$ end', 'b.md': 'User text' } });
		const plugin = new SteadyInlineMathPlugin(app as never, manifest as never);
		plugin.queueRestore('a.md', 'A ${} x{}$ end', 'A $ x$ end');
		plugin.queueRestore('b.md', 'A ${}x{}$ end', 'A $x$ end');
		await new Promise((r) => setTimeout(r, 10));
		expect(await app.vault.read(app.vault.getFileByPath('a.md')!)).toBe('A $ x$ end');
		expect(await app.vault.read(app.vault.getFileByPath('b.md')!)).toBe('User text');
	});
});
