import { describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import TagPropertiesPlugin from '../src/main';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import manifest from '../manifest.json';

describe('saved settings', () => {
	it('loads with defaults against an in-memory vault', async () => {
		const app = App.createConfigured__({ files: { 'notes/a.md': '# Hello' } });
		const plugin = new TagPropertiesPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
	});
	it.each([null, undefined, {}, { properties: 5, includeCore: 'yes' }])('repairs invalid saved data %j', (value) => {
		expect(normalizeSettings(value as never)).toEqual(DEFAULT_SETTINGS);
	});
	it('keeps valid configuration', () => {
		expect(normalizeSettings({ properties: 'topics,company', includeCore: true })).toEqual({ properties: 'topics,company', includeCore: true });
	});
});
