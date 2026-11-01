import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, SettingTab } from 'obsidian-test-mocks/obsidian';
import WikilinkAliasMarkupPlugin from '../src/main';
import { PRO_LEADS, WikilinkAliasMarkupSettingTab } from '../src/settings';
import { bindPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';

/** A tab for a plugin that is not loaded. redrawAll is a spy, so the test sees each redraw. */
function tab(): { t: WikilinkAliasMarkupSettingTab; plugin: WikilinkAliasMarkupPlugin; redraw: ReturnType<typeof vi.fn> } {
	const app = App.createConfigured__({ files: {} });
	const plugin = new WikilinkAliasMarkupPlugin(app as never, manifest as never);
	const redraw = vi.fn();
	plugin.redrawAll = redraw;
	return { t: new WikilinkAliasMarkupSettingTab(app as never, plugin), plugin, redraw };
}

describe('Pro settings in the settings tab', () => {
	afterEach(() => {
		resetPro();
		vi.restoreAllMocks();
	});

	it('names the Pro feature in the lead', () => {
		expect(PRO_LEADS).toEqual({ math: 'Math in aliases is a Pro feature.' });
	});

	it('A12 a free user who turns on math does not save it and sees off', async () => {
		const { t, plugin, redraw } = tab();
		vi.spyOn(t, 'update').mockImplementation(() => undefined);
		const save = vi.spyOn(SettingTab.prototype, 'setControlValue');
		await t.setControlValue('math', true);
		expect(save).not.toHaveBeenCalled();
		expect(redraw).not.toHaveBeenCalled();
		expect(t.getControlValue('math')).toBe(false);
		expect(plugin.settings.math).toBe(true);
	});

	it('a free user can turn Live Preview off', async () => {
		const { t, redraw } = tab();
		const save = vi.spyOn(SettingTab.prototype, 'setControlValue').mockImplementation(() => undefined);
		await t.setControlValue('livePreview', false);
		expect(save.mock.calls).toEqual([['livePreview', false]]);
		expect(redraw).toHaveBeenCalledTimes(1);
	});

	it('a Pro user saves the math setting', async () => {
		bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
		const { t, redraw } = tab();
		const save = vi.spyOn(SettingTab.prototype, 'setControlValue').mockImplementation(() => undefined);
		await t.setControlValue('math', false);
		expect(save.mock.calls).toEqual([['math', false]]);
		expect(redraw).toHaveBeenCalledTimes(1);
	});
});
