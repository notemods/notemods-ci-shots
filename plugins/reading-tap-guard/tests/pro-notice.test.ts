import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Notice } from 'obsidian-test-mocks/obsidian';
import type { SponsorsManager } from '../src/license/index';
import ReadingTapGuardPlugin from '../src/main';
import { ReadingTapGuardSettingTab } from '../src/settings';
import { PRO_INTERVAL, bindPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';

// A free user can select Double tap interval. The select shows the shared Pro notice with the "Sponsor on GitHub"
// button. Nothing is saved, and the dropdown shows the interval in effect: 500 ms.
const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';

function fakePro(pro: boolean): SponsorsManager {
	return {
		isPro: () => pro,
		onChange: () => () => undefined,
		hasToken: () => false,
		isChecking: () => false,
		getState: () => ({ status: 'unchecked', lastAttemptAt: 0 }),
		config: { sponsorLogin: 'theluckystrike', source: 'reading-tap-guard' },
	} as unknown as SponsorsManager;
}

async function setup(pro: boolean) {
	const app = App.createConfigured__({ files: {} });
	const plugin = new ReadingTapGuardPlugin(app as never, manifest as never);
	await plugin.loadSettings();
	bindPro(fakePro(pro));
	plugin.saveSettings = vi.fn(async () => undefined);
	const shown: { text: string; buttons: number }[] = [];
	vi.spyOn(Notice.prototype as unknown as { constructor__(): void }, 'constructor__').mockImplementation(function (this: Notice) {
		shown.push({ text: this.messageEl.textContent ?? '', buttons: this.messageEl.querySelectorAll('.pf-pro-notice-sponsor').length });
	});
	const tab = new ReadingTapGuardSettingTab(app as never, plugin);
	const update = vi.spyOn(tab, 'update').mockImplementation(() => undefined);
	type Def = { control?: { key: string; disabled?: () => boolean } };
	const control = (tab.getSettingDefinitions() as Def[]).find((d) => d.control?.key === 'intervalText')!.control!;
	return { plugin, tab, shown, update, control };
}

describe('Double tap interval (Pro)', () => {
	afterEach(() => { resetPro(); vi.restoreAllMocks(); });

	it('a free user who selects a shorter interval gets the Pro notice with a Sponsor button, nothing is saved, and the dropdown shows 500 ms', async () => {
		const { plugin, tab, shown, update, control } = await setup(false);
		// A lapsed sponsor keeps a saved interval.
		plugin.settings.interval = 250;
		expect(control.disabled?.() ?? false).toBe(false);
		expect(tab.getControlValue('intervalText')).toBe('500');
		await tab.setControlValue('intervalText', '300');
		expect(shown).toEqual([{ text: `${PRO_INTERVAL} ${PITCH}Sponsor on GitHub`, buttons: 1 }]);
		expect(update).toHaveBeenCalledOnce();
		expect(plugin.saveSettings).not.toHaveBeenCalled();
		expect(plugin.settings.interval).toBe(250);
	});

	it('a Pro user who selects a shorter interval saves it, with no Pro notice', async () => {
		const { plugin, tab, shown } = await setup(true);
		await tab.setControlValue('intervalText', '300');
		expect(plugin.settings.interval).toBe(300);
		expect(tab.getControlValue('intervalText')).toBe('300');
		expect(plugin.saveSettings).toHaveBeenCalledOnce();
		expect(shown).toEqual([]);
	});
});
