import { describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import LineCutGuardPlugin from '../src/main';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import manifest from '../manifest.json';

describe('LineCutGuardPlugin', () => {
	it('loads with default settings against an in-memory vault', async () => {
		const app = App.createConfigured__({ files: { 'notes/a.md': '# Hello world' } });
		const plugin = new LineCutGuardPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(DEFAULT_SETTINGS).toEqual({ cut: 'block', copy: 'allow', notice: true });
	});

	it('repairs bad saved settings and keeps good ones', () => {
		expect(normalizeSettings({ cut: 'never' as never, copy: 5 as never, notice: 'yes' as never })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ cut: 'allow', copy: 'twice', notice: false })).toEqual({ cut: 'allow', copy: 'twice', notice: false });
	});
});
