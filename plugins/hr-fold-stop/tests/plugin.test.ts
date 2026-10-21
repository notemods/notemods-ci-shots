import { afterEach, describe, expect, it, vi } from 'vitest';
import { Setting } from 'obsidian';
import { App } from 'obsidian-test-mocks/obsidian';
import HrFoldStopPlugin from '../src/main';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import { bindPro, resetPro, isPro, SPONSORS } from '../src/pro';
import { effectiveRuleOf, HrFoldStopSettingTab } from '../src/settings';
import manifest from '../manifest.json';

afterEach(() => resetPro());

describe('HrFoldStopPlugin', () => {
	it('loads with default settings against an in-memory vault', async () => {
		const app = App.createConfigured__({ files: { 'notes/a.md': '# Hello world' } });
		const plugin = new HrFoldStopPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
	});

	it('repairs bad saved settings', () => {
		expect(normalizeSettings({ enabled: 5 as never })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
	});
});

it('saved paid rules do not affect the free feature without a sponsor', () => {
 const settings = { ...DEFAULT_SETTINGS, folders: [{ folder: 'Archive', enabled: false }] };
 expect(effectiveRuleOf(settings)).toEqual({ vaultEnabled: true, folders: [], overrideProperty: '' });
 bindPro({ isPro: () => true, onChange: () => () => {} } as never);
 expect(effectiveRuleOf(settings).folders).toEqual(settings.folders);
 expect(effectiveRuleOf(settings).overrideProperty).toBe('fold-stop');
 resetPro();
 expect(isPro()).toBe(false);
 expect(effectiveRuleOf(settings).folders).toEqual([]);
});

it('uses the reference sponsor price and client', () => {
 expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', minMonthlyUsd: 5, oneTimeUsd: 15, oneTimeMonths: 0, scope: 'read:user' });
});

it('free controls and paid controls are present in the settings definitions', () => {
 const app = App.createConfigured__({ files: { 'A.md': '# A' } });
 const plugin = new HrFoldStopPlugin(app as never, manifest as never);
 const tab = new HrFoldStopSettingTab(app as never, plugin);
 const names = tab.getSettingDefinitions().map(item => 'name' in item ? item.name : '');
 expect(names).toContain('Stop folds at horizontal rules');
 expect(names).toContain('Folder rules (Pro)');
 expect(names).toContain('Override property (Pro)');
});

it('updates the effective rule row after a folder path changes', () => {
 const app = App.createConfigured__({ files: { 'Archive/A.md': '# A' } });
 vi.spyOn(app.workspace, 'getActiveFile').mockReturnValue({ path: 'Archive/A.md' } as never);
 const plugin = new HrFoldStopPlugin(app as never, manifest as never);
 bindPro({ isPro: () => true, onChange: () => () => {} } as never);
 const tab = new HrFoldStopSettingTab(app as never, plugin);
 const definition = tab.getSettingDefinitions().find(item => 'name' in item && item.name === 'Effective rule (Pro)');
 const setting = new Setting(document.createElement('div'));
 if (!definition || !('render' in definition) || !definition.render) throw new Error('Missing effective rule row');
 const cleanup = definition.render(setting, {} as never);
 expect(setting.descEl.textContent).toContain('the vault toggle');
 plugin.settings.folders = [{ folder: 'Archive', enabled: false }];
 tab.refreshEffectiveRule();
 expect(setting.descEl.textContent).toContain('off');
 expect(setting.descEl.textContent).toContain('folder Archive');
 cleanup?.();
 vi.restoreAllMocks();
});
