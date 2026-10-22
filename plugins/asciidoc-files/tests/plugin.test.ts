import { describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import AsciidocFilesPlugin from '../src/main';
import { isPro, onProChange } from '../src/pro';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import manifest from '../manifest.json';

function makePlugin() {
	const app = App.createConfigured__({ files: { 'docs/guide.adoc': '= Guide\n\ninclude::part.adoc[]\n', 'docs/part.adoc': '== Part\n' } });
	return new AsciidocFilesPlugin(app as never, manifest as never);
}

describe('AsciidocFilesPlugin', () => {
	it('loads default settings from an empty data.json', async () => {
		const plugin = makePlugin();
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
	});

	it('repairs bad saved settings and clamps numbers', () => {
		expect(normalizeSettings({ mode: 'raw' as never, delay: 5, depth: 40, includes: 'yes' as never })).toEqual({ ...DEFAULT_SETTINGS, delay: 100, depth: 8 });
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ mode: 'split', delay: 1234.4 })).toEqual({ ...DEFAULT_SETTINGS, mode: 'split', delay: 1234 });
	});

	it('without Pro the facade is off and includes become notes, with no vault read', async () => {
		const plugin = makePlugin();
		await plugin.loadSettings();
		expect(isPro()).toBe(false);
		expect(plugin.isPro()).toBe(false);
		expect(onProChange(() => undefined)).toBeTypeOf('function');
		const r = await plugin.expand('= Guide\n\ninclude::part.adoc[]\n', 'docs/guide.adoc');
		expect(r.includes.map((i) => i.status)).toEqual(['off']);
		expect(r.text).toContain('includes are resolved with Pro');
		expect(r.text).not.toContain('== Part');
	});
});
