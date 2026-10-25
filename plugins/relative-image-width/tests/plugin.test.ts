import { describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import RelativeImageWidthPlugin from '../src/main';
import { DEFAULT_SETTINGS, effectiveOptions, normalizeSettings } from '../src/settings';
import manifest from '../manifest.json';

describe('RelativeImageWidthPlugin', () => {
	it('loads with default settings against an in-memory vault', async () => {
		const app = App.createConfigured__({ files: { 'notes/a.md': '# Hello world' } });
		const plugin = new RelativeImageWidthPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(DEFAULT_SETTINGS.pandoc).toBe(false);
	});

	it('repairs bad saved settings', () => {
		expect(normalizeSettings({ pandoc: 'yes' as never, defaultSize: 5 as never })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ pandoc: true, defaultSize: ' 100% ' })).toEqual({ pandoc: true, defaultSize: '100%' });
	});

	it('gives the default size only with Pro', () => {
		const s = { pandoc: false, defaultSize: '100%' };
		expect(effectiveOptions(s, false).fallback).toBeNull();
		expect(effectiveOptions(s, true).fallback?.(undefined)).toEqual({ width: '100%', height: null });
		expect(effectiveOptions(s, true).fallback?.('20rem')).toEqual({ width: '20rem', height: null });
	});
});
