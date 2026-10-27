import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Notice } from 'obsidian-test-mocks/obsidian';
import type { SponsorsManager } from '../src/license/index';
import CraftLinkRepairPlugin from '../src/main';
import { CraftLinkRepairSettingTab, DEFAULT_SETTINGS } from '../src/settings';
import { bindPro, resetPro } from '../src/pro';
import { RepairModal } from '../src/ui';
import manifest from '../manifest.json';

// A free user can select the 4 Pro rows of the settings tab, and can preview a pass with more than 10 note copies.
// Each one shows the shared Pro notice with the "Sponsor on GitHub" button. Nothing is saved, and the rows show the
// values in effect. A Pro user saves the same rows with no notice.
const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';
const OUTPUT = 'Output folder, date note folder and date format choices need Pro.';
const AUTO = 'Repair new exports needs Pro.';
const LIMIT = 'A pass with more than 10 note copies needs Pro.';

function fakePro(pro: boolean): SponsorsManager {
	return {
		isPro: () => pro,
		onChange: () => () => undefined,
		hasToken: () => false,
		isChecking: () => false,
		getState: () => ({ status: 'unchecked', lastAttemptAt: 0 }),
		config: { sponsorLogin: 'theluckystrike', source: 'craft-link-repair' },
	} as unknown as SponsorsManager;
}

function setup(pro: boolean, files: Record<string, string> = {}) {
	const app = App.createConfigured__({ files });
	const plugin = new CraftLinkRepairPlugin(app as never, manifest as never);
	plugin.settings = { ...DEFAULT_SETTINGS };
	const saved: unknown[] = [];
	plugin.saveData = vi.fn(async (data: unknown) => { saved.push(structuredClone(data)); });
	bindPro(fakePro(pro));
	const shown: { text: string; buttons: number }[] = [];
	vi.spyOn(Notice.prototype as unknown as { constructor__(): void }, 'constructor__').mockImplementation(function (this: Notice) {
		shown.push({ text: this.messageEl.textContent ?? '', buttons: this.messageEl.querySelectorAll('.pf-pro-notice-sponsor').length });
	});
	const tab = new CraftLinkRepairSettingTab(app as never, plugin);
	tab.update = vi.fn();
	return { app, plugin, tab, saved, shown };
}

/** The control definitions of the Pro group. */
function proControls(tab: CraftLinkRepairSettingTab) {
	const group = tab.productSettingDefinitions().find((d) => 'type' in d && d.type === 'group') as { items: { control: { key: string; disabled?: () => boolean } }[] };
	return group.items.map((i) => i.control);
}

describe('Pro controls for a free user', () => {
	afterEach(() => { resetPro(); vi.restoreAllMocks(); });

	it('a free user who selects a Pro row of the settings tab gets the Pro notice with a Sponsor button, and nothing is saved', async () => {
		const { plugin, tab, saved, shown } = setup(false);
		// The rows are not disabled.
		for (const c of proControls(tab)) expect(c.disabled?.() ?? false).toBe(false);
		// A blur moves the focus out, so that Obsidian draws the row again with the value in effect.
		activeDocument.body.appendChild(tab.containerEl);
		const input = tab.containerEl.createEl('input');
		input.focus();
		await tab.setControlValue('outputFolder', 'C');
		expect(activeDocument.activeElement).not.toBe(input);
		await tab.setControlValue('dateFolder', 'D');
		await tab.setControlValue('dateFormat', 'YYYY.MM.DD');
		await tab.setControlValue('automatic', true);
		tab.containerEl.remove();
		expect(shown).toEqual([
			{ text: `${OUTPUT} ${PITCH}Sponsor on GitHub`, buttons: 1 },
			{ text: `${OUTPUT} ${PITCH}Sponsor on GitHub`, buttons: 1 },
			{ text: `${OUTPUT} ${PITCH}Sponsor on GitHub`, buttons: 1 },
			{ text: `${AUTO} ${PITCH}Sponsor on GitHub`, buttons: 1 },
		]);
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(saved).toEqual([]);
		expect(tab.update).toHaveBeenCalledTimes(4);
		// The free export folder still saves, with no notice.
		await tab.setControlValue('folder', 'Export');
		expect(plugin.settings.folder).toBe('Export');
		expect(shown).toHaveLength(4);
	});

	it('a free user sees the values in effect; the stored Pro choices stay', () => {
		const { plugin, tab } = setup(false);
		plugin.settings = { folder: 'E', outputFolder: 'Out', dateFolder: 'Days', dateFormat: 'YYYY/MM/DD', automatic: true };
		expect(tab.getControlValue('outputFolder')).toBe('');
		expect(tab.getControlValue('dateFolder')).toBe('');
		expect(tab.getControlValue('dateFormat')).toBe('YYYY-MM-DD');
		expect(tab.getControlValue('automatic')).toBe(false);
		expect(tab.getControlValue('folder')).toBe('E');
		expect(plugin.settings.outputFolder).toBe('Out');
	});

	it('a free preview of more than 10 note copies shows the Pro notice with a Sponsor button and writes nothing', async () => {
		const files = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`Export/${i}.md`, 'note']));
		const { app, plugin, shown } = setup(false, files);
		const modal = new RepairModal(plugin);
		modal.onOpen();
		const button = [...modal.contentEl.querySelectorAll('button')].find((b) => b.textContent === 'Preview links')!;
		(modal.contentEl.querySelector('input') as HTMLInputElement).value = 'Export';
		modal.contentEl.querySelector('input')!.dispatchEvent(new Event('input'));
		button.click();
		await vi.waitFor(() => { expect(modal.contentEl.querySelector('.craft-repair-summary')).not.toBeNull(); });
		expect(shown).toEqual([{ text: `${LIMIT} ${PITCH}Sponsor on GitHub`, buttons: 1 }]);
		expect(modal.contentEl.textContent).toContain('Free limit: 11 notes exceeds 10.');
		expect([...modal.contentEl.querySelectorAll('button')].find((b) => b.textContent === 'Write copies')?.disabled).toBe(true);
		expect(app.vault.getFiles()).toHaveLength(11);
		modal.close();
	});

	it('a Pro user saves the Pro rows and previews 11 copies with no notice', async () => {
		const files = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`Export/${i}.md`, 'note']));
		const { plugin, tab, shown } = setup(true, files);
		expect(tab.getControlValue('dateFormat')).toBe('YYYY-MM-DD');
		await tab.setControlValue('dateFormat', 'YYYY.MM.DD');
		await tab.setControlValue('automatic', true);
		expect(plugin.settings.dateFormat).toBe('YYYY.MM.DD');
		expect(plugin.settings.automatic).toBe(true);
		expect(tab.getControlValue('automatic')).toBe(true);
		const modal = new RepairModal(plugin);
		modal.onOpen();
		(modal.contentEl.querySelector('input') as HTMLInputElement).value = 'Export';
		modal.contentEl.querySelector('input')!.dispatchEvent(new Event('input'));
		[...modal.contentEl.querySelectorAll('button')].find((b) => b.textContent === 'Preview links')!.click();
		await vi.waitFor(() => { expect(modal.contentEl.querySelector('.craft-repair-summary')?.textContent).toContain('11 copies'); });
		expect([...modal.contentEl.querySelectorAll('button')].find((b) => b.textContent === 'Write copies')?.disabled).toBe(false);
		expect(shown).toEqual([]);
		modal.close();
	});
});
