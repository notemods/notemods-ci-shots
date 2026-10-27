import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Notice } from 'obsidian-test-mocks/obsidian';
import type { SponsorsManager } from '../src/license/index';
import PropertiesPdfExportPlugin from '../src/main';
import { PropertiesPdfExportSettingTab } from '../src/settings';
import { bindPro } from '../src/pro';
import manifest from '../manifest.json';

// A free user can edit Folder layouts. Before, the text saved but did nothing. Now the edit shows the shared Pro
// notice with the "Sponsor on GitHub" button, nothing is saved, and the field draws the saved rules again (README: saved rules remain in settings).
// A Pro user saves the rules with no notice.
const LEAD = 'Folder layouts need Pro.';
const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';

function fakePro(pro: boolean): SponsorsManager {
	return {
		isPro: () => pro,
		onChange: () => () => undefined,
		hasToken: () => false,
		isChecking: () => false,
		getState: () => ({ status: 'unchecked', lastAttemptAt: 0 }),
		config: { sponsorLogin: 'theluckystrike', source: 'properties-pdf-export' },
	} as unknown as SponsorsManager;
}

function setup(pro: boolean) {
	const app = App.createConfigured__({ files: {} });
	const plugin = new PropertiesPdfExportPlugin(app as never, manifest as never);
	plugin.saveSettings = vi.fn(async () => undefined);
	bindPro(fakePro(pro));
	const shown: { text: string; buttons: number }[] = [];
	vi.spyOn(Notice.prototype as unknown as { constructor__(): void }, 'constructor__').mockImplementation(function (this: Notice) {
		shown.push({ text: this.messageEl.textContent ?? '', buttons: this.messageEl.querySelectorAll('.pf-pro-notice-sponsor').length });
	});
	const tab = new PropertiesPdfExportSettingTab(app as never, plugin);
	tab.update = vi.fn();
	const base = vi.spyOn(Object.getPrototypeOf(PropertiesPdfExportSettingTab.prototype) as { setControlValue(k: string, v: unknown): unknown }, 'setControlValue');
	return { plugin, tab, shown, base };
}

describe('Folder layouts for a free user', () => {
	afterEach(() => { bindPro(null); vi.restoreAllMocks(); });

	it('a free user who edits Folder layouts gets the Pro notice with a Sponsor button, and nothing is saved', async () => {
		const { plugin, tab, shown, base } = setup(false);
		const before = JSON.stringify(plugin.settings);
		activeDocument.body.appendChild(tab.containerEl);
		const field = tab.containerEl.createEl('textarea');
		field.focus();
		await tab.setControlValue('folderLayouts', 'Reports = compact');
		// The focus leaves the field, so that Obsidian draws it again with the saved rules.
		expect(activeDocument.activeElement).not.toBe(field);
		tab.containerEl.remove();
		expect(shown).toEqual([{ text: `${LEAD} ${PITCH}Sponsor on GitHub`, buttons: 1 }]);
		expect(base).not.toHaveBeenCalled();
		expect(plugin.saveSettings).not.toHaveBeenCalled();
		expect(JSON.stringify(plugin.settings)).toBe(before);
		expect(tab.update).toHaveBeenCalledTimes(1);
		// The free rows still save with no notice.
		await tab.setControlValue('layout', 'compact');
		expect(base).toHaveBeenCalledWith('layout', 'compact');
		expect(shown).toHaveLength(1);
	});

	it('a Pro user saves Folder layouts with no notice', async () => {
		const { plugin, tab, shown, base } = setup(true);
		await tab.setControlValue('folderLayouts', 'Reports = compact');
		expect(base).toHaveBeenCalledWith('folderLayouts', 'Reports = compact');
		expect(plugin.saveSettings).toHaveBeenCalled();
		expect(shown).toEqual([]);
	});
});
