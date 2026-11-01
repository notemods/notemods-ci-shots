import { describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import WikilinkAliasMarkupPlugin from '../src/main';
import { DEFAULT_SETTINGS, effectiveOptions, normalizeSettings } from '../src/settings';
import manifest from '../manifest.json';

describe('WikilinkAliasMarkupPlugin', () => {
	it('loads with default settings against an in-memory vault', async () => {
		const app = App.createConfigured__({ files: { 'notes/a.md': '# Hello world' } });
		const plugin = new WikilinkAliasMarkupPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
	});

	it('repairs bad saved settings', () => {
		expect(normalizeSettings({ livePreview: 5 as never, math: 'yes' as never })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ livePreview: false })).toEqual({ livePreview: false, math: true });
	});

	it('A12 keeps math off without Pro, also when the setting is on', () => {
		expect(effectiveOptions({ livePreview: true, math: true }, false)).toEqual({ livePreview: true, math: false });
		expect(effectiveOptions({ livePreview: true, math: true }, true)).toEqual({ livePreview: true, math: true });
		expect(effectiveOptions({ livePreview: false, math: false }, true)).toEqual({ livePreview: false, math: false });
	});
});
