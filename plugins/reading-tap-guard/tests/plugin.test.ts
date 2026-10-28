import { describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import ReadingTapGuardPlugin from '../src/main';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import manifest from '../manifest.json';

describe('ReadingTapGuardPlugin', () => {
	it('loads with default settings against an in-memory vault', async () => {
		const app = App.createConfigured__({ files: { 'notes/a.md': '# Hello world' } });
		const plugin = new ReadingTapGuardPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(plugin.settings.action).toBe('nothing');
	});

	it('repairs bad saved settings', () => {
		expect(normalizeSettings({ action: 5 as never })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ action: 'toString' as never })).toEqual(DEFAULT_SETTINGS);
	});
});
