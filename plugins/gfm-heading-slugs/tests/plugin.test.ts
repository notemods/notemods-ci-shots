import { describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import GfmHeadingSlugsPlugin from '../src/main';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import manifest from '../manifest.json';

describe('GfmHeadingSlugsPlugin', () => {
	it('loads with default settings against an in-memory vault', async () => {
		const app = App.createConfigured__({ files: { 'notes/a.md': '# Hello world' } });
		const plugin = new GfmHeadingSlugsPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(DEFAULT_SETTINGS.useSlugs).toBe(true);
	});

	it('repairs bad saved settings', () => {
		expect(normalizeSettings({ useSlugs: 'yes' as never, rewriteInserted: 3 as never })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ useSlugs: false }).useSlugs).toBe(false);
	});
});
