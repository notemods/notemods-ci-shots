import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, SettingTab } from 'obsidian-test-mocks/obsidian';
import OneWayBacklinksPlugin from '../src/main';
import { DEFAULT_SETTINGS, OneWayBacklinksSettingTab, PRO_LEADS, effectiveHiddenFolders, normalizeSettings } from '../src/settings';
import { bindPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';

function tab(): { t: OneWayBacklinksSettingTab; plugin: OneWayBacklinksPlugin; refresh: ReturnType<typeof vi.fn> } {
	const app = App.createConfigured__({ files: {} });
	const plugin = new OneWayBacklinksPlugin(app as never, manifest as never);
	const refresh = vi.fn();
	plugin.refreshViews = refresh;
	return { t: new OneWayBacklinksSettingTab(app as never, plugin), plugin, refresh };
}

describe('OneWayBacklinksPlugin', () => {
	afterEach(() => {
		resetPro();
		vi.restoreAllMocks();
	});

	it('loads with default settings against an in-memory vault', async () => {
		const app = App.createConfigured__({ files: { 'notes/a.md': '# Hello world' } });
		const plugin = new OneWayBacklinksPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(DEFAULT_SETTINGS.defaultList).toBe('one-way');
	});

	it('repairs bad saved settings', () => {
		expect(normalizeSettings({ defaultList: 'both' as never, hiddenFolders: 5 as never, paneAdded: 'yes' as never })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ defaultList: 'paired', paneAdded: true }).defaultList).toBe('paired');
	});

	it('hides no folder without Pro, and keeps the stored text', () => {
		const s = { ...DEFAULT_SETTINGS, hiddenFolders: 'Daily\nArchive/' };
		expect(effectiveHiddenFolders(s, false)).toEqual([]);
		expect(effectiveHiddenFolders(s, true)).toEqual(['Daily', 'Archive']);
	});

	it('names the Pro feature in each lead', () => {
		expect(PRO_LEADS).toEqual({ hiddenFolders: 'Hidden folders is a Pro feature.', linkBack: 'Link back is a Pro feature.' });
	});

	it('a free user who types hidden folders does not save them and sees an empty field', async () => {
		const { t, plugin, refresh } = tab();
		vi.spyOn(t, 'update').mockImplementation(() => undefined);
		const save = vi.spyOn(SettingTab.prototype, 'setControlValue');
		plugin.settings = { ...DEFAULT_SETTINGS, hiddenFolders: 'Kept' };
		await t.setControlValue('hiddenFolders', 'Daily');
		expect(save).not.toHaveBeenCalled();
		expect(refresh).not.toHaveBeenCalled();
		expect(plugin.settings.hiddenFolders).toBe('Kept');
		expect(t.getControlValue('hiddenFolders')).toBe('');
	});

	it('a free user can change the default list', async () => {
		const { t, refresh } = tab();
		const save = vi.spyOn(SettingTab.prototype, 'setControlValue').mockImplementation(async () => undefined);
		await t.setControlValue('defaultList', 'paired');
		expect(save).toHaveBeenCalledWith('defaultList', 'paired');
		expect(refresh).toHaveBeenCalledTimes(1);
	});

	it('a Pro user saves hidden folders', async () => {
		bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
		const { t, refresh } = tab();
		const save = vi.spyOn(SettingTab.prototype, 'setControlValue').mockImplementation(async () => undefined);
		await t.setControlValue('hiddenFolders', 'Daily');
		expect(save).toHaveBeenCalledWith('hiddenFolders', 'Daily');
		expect(refresh).toHaveBeenCalledTimes(1);
	});
});
