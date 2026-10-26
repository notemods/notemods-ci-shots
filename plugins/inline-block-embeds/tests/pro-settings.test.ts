import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, SettingTab } from 'obsidian-test-mocks/obsidian';
import InlineBlockEmbedsPlugin from '../src/main';
import { InlineBlockEmbedsSettingTab, PRO_LEADS } from '../src/settings';
import { bindPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';

/** A tab for a plugin that is not loaded. redrawAll is a spy, so the test sees each redraw. */
function tab(): { t: InlineBlockEmbedsSettingTab; plugin: InlineBlockEmbedsPlugin; redraw: ReturnType<typeof vi.fn> } {
	const app = App.createConfigured__({ files: {} });
	const plugin = new InlineBlockEmbedsPlugin(app as never, manifest as never);
	const redraw = vi.fn();
	plugin.redrawAll = redraw;
	return { t: new InlineBlockEmbedsSettingTab(app as never, plugin), plugin, redraw };
}

describe('Pro settings in the settings tab', () => {
	afterEach(() => {
		resetPro();
		vi.restoreAllMocks();
	});

	it('names the Pro feature in each lead', () => {
		expect(PRO_LEADS).toEqual({ drawAll: 'Drawing every block embed inline is a Pro feature.', style: 'The soft background and none styles are Pro features.' });
	});

	it('a free user who selects a Pro setting does not save it, and the tab draws the saved value again', async () => {
		const { t, plugin, redraw } = tab();
		const save = vi.spyOn(SettingTab.prototype, 'setControlValue');
		const update = vi.spyOn(t, 'update');
		await t.setControlValue('drawAll', true);
		await t.setControlValue('style', 'background');
		expect(save).not.toHaveBeenCalled();
		expect(update).toHaveBeenCalledTimes(2);
		expect(redraw).not.toHaveBeenCalled();
		expect(plugin.settings).toEqual({ drawAll: false, style: 'underline' });
	});

	it('a Pro user who selects a Pro setting saves it, as before', async () => {
		bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
		const { t, redraw } = tab();
		const save = vi.spyOn(SettingTab.prototype, 'setControlValue');
		const update = vi.spyOn(t, 'update');
		await t.setControlValue('drawAll', true);
		await t.setControlValue('style', 'background');
		expect(save.mock.calls).toEqual([['drawAll', true], ['style', 'background']]);
		expect(update).not.toHaveBeenCalled();
		expect(redraw).toHaveBeenCalledTimes(2);
	});
});
