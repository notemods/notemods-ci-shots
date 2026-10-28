import { describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import PropertiesPdfExportPlugin from '../src/main';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/header';
import manifest from '../manifest.json';

describe('PropertiesPdfExportPlugin', () => {
	it('loads with default settings against an in-memory vault', async () => {
		const app = App.createConfigured__({ files: { 'notes/a.md': '# Hello world' } });
		const plugin = new PropertiesPdfExportPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
	});

	it('repairs bad saved settings', () => {
		expect(normalizeSettings({ layout: 5 })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
	});
});
