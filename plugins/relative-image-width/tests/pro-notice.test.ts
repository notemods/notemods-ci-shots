import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Notice } from 'obsidian-test-mocks/obsidian';
import type { SponsorsManager } from '../src/license/index';
import RelativeImageWidthPlugin from '../src/main';
import { RelativeImageWidthSettingTab } from '../src/settings';
import { bindPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';

// A free user can select Default image size, and can set the image-width property in the open note. Both show the
// shared Pro notice with the "Sponsor on GitHub" button. Nothing is saved, and the images keep their size.
const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';
const SIZE = 'A default image size needs Pro.';
const PROPERTY = 'The image-width note property needs Pro.';
const notice = (lead: string) => ({ text: `${lead} ${PITCH}Sponsor on GitHub`, buttons: 1 });

function fakePro(pro: boolean): SponsorsManager {
	return {
		isPro: () => pro,
		onChange: () => () => undefined,
		hasToken: () => false,
		isChecking: () => false,
		getState: () => ({ status: 'unchecked', lastAttemptAt: 0 }),
		config: { sponsorLogin: 'theluckystrike', source: 'relative-image-width' },
	} as unknown as SponsorsManager;
}

async function setup(pro: boolean) {
	const app = App.createConfigured__({ files: { 'a.md': '# A', 'b.md': '# B' } });
	const plugin = new RelativeImageWidthPlugin(app as never, manifest as never);
	await plugin.loadSettings();
	plugin.settings.defaultSize = '100%';
	const save = vi.spyOn(plugin, 'saveSettings').mockResolvedValue();
	const rerender = vi.spyOn(plugin, 'rerenderReading').mockImplementation(() => undefined);
	bindPro(fakePro(pro));
	const tab = new RelativeImageWidthSettingTab(app as never, plugin);
	tab.update = vi.fn();
	const shown: { text: string; buttons: number }[] = [];
	vi.spyOn(Notice.prototype as unknown as { constructor__(): void }, 'constructor__').mockImplementation(function (this: Notice) {
		shown.push({ text: this.messageEl.textContent ?? '', buttons: this.messageEl.querySelectorAll('.pf-pro-notice-sponsor').length });
	});
	const active = (path: string) => vi.spyOn(app.workspace, 'getActiveFile').mockReturnValue(app.vault.getFileByPath(path) as never);
	const file = (path: string) => app.vault.getFileByPath(path) as never;
	return { plugin, tab, save, rerender, shown, active, file };
}
type Item = { control?: { key: string; disabled?: () => boolean } };

describe('Pro moments of Relative Image Width', () => {
	afterEach(() => { resetPro(); vi.restoreAllMocks(); });

	it('a free user who selects Default image size gets the Pro notice with a Sponsor button, nothing is saved, and the row shows no size', async () => {
		const { plugin, tab, save, shown } = await setup(false);
		const row = (tab.productSettingDefinitions() as unknown as Item[]).find((i) => i.control?.key === 'defaultSize')!;
		expect(row.control!.disabled?.() ?? false).toBe(false);
		await tab.setControlValue('defaultSize', '50%');
		expect(shown).toEqual([notice(SIZE)]);
		expect(save).not.toHaveBeenCalled();
		expect(plugin.settings.defaultSize).toBe('100%');
		expect(tab.update).toHaveBeenCalledTimes(1);
		expect(tab.getControlValue('defaultSize')).toBe('');
		await tab.setControlValue('pandoc', true);
		expect(save).toHaveBeenCalledTimes(1);
		expect(shown).toHaveLength(1);
	});

	it('a free user who sets image-width in the open note gets the Pro notice once in a session; other notes and removals show none', async () => {
		const { plugin, rerender, shown, active, file } = await setup(false);
		active('a.md');
		plugin.onMetadataChanged(file('b.md'), { 'image-width': '50%' });
		expect(shown).toEqual([]);
		plugin.onMetadataChanged(file('a.md'), { 'image-width': '50%' });
		expect(shown).toEqual([notice(PROPERTY)]);
		plugin.onMetadataChanged(file('a.md'), { 'image-width': '40%' });
		plugin.onMetadataChanged(file('a.md'), {});
		expect(shown).toEqual([notice(PROPERTY)]);
		expect(rerender).not.toHaveBeenCalled();
	});

	it('a Pro user sets the default size and the property, and the images are sized again, with no Pro notice', async () => {
		const { plugin, tab, save, rerender, shown, active, file } = await setup(true);
		await tab.setControlValue('defaultSize', '50%');
		expect(save).toHaveBeenCalled();
		active('a.md');
		plugin.onMetadataChanged(file('a.md'), { 'image-width': '50%' });
		expect(rerender).toHaveBeenCalledWith('a.md');
		expect(shown).toEqual([]);
	});
});
