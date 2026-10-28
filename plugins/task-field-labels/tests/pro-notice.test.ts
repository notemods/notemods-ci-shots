import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Notice, Setting } from 'obsidian-test-mocks/obsidian';
import type { SponsorsManager } from '../src/license/index';
import type { SettingDefinitionItem } from 'obsidian';
import TaskFieldLabelsPlugin from '../src/main';
import { TaskFieldLabelsSettingTab } from '../src/settings';
import { FIELDS, LABELS } from '../src/fields';
import { bindPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';

// A free user can select every Pro row of the settings tab. A select shows the shared Pro notice with the
// "Sponsor on GitHub" button. Nothing is saved, and the tab draws again with the values in effect.
const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';
const LABELS_LEAD = 'Custom field labels and the compact layout need Pro.';
const PRESETS_LEAD = 'Display presets and folder rules need Pro.';
const notice = (lead: string) => ({ text: `${lead} ${PITCH}Sponsor on GitHub`, buttons: 1 });

function fakePro(pro: boolean): SponsorsManager {
	return {
		isPro: () => pro,
		onChange: () => () => undefined,
		hasToken: () => false,
		isChecking: () => false,
		getState: () => ({ status: 'unchecked', lastAttemptAt: 0 }),
		config: { sponsorLogin: 'theluckystrike', source: 'task-field-labels' },
	} as unknown as SponsorsManager;
}

async function setup(pro: boolean) {
	const plugin = new TaskFieldLabelsPlugin(App.createConfigured__() as never, manifest as never);
	await plugin.loadSettings();
	// A lapsed sponsor: stored Pro values that are not in effect without Pro.
	plugin.settings.labels.due = 'Deadline'; plugin.settings.compact = true; plugin.settings.folderRules = 'Work|Team';
	const save = vi.spyOn(plugin, 'saveData').mockResolvedValue();
	bindPro(fakePro(pro));
	const tab = new TaskFieldLabelsSettingTab(plugin.app as never, plugin);
	tab.plugin = plugin;
	tab.update = vi.fn();
	const shown: { text: string; buttons: number }[] = [];
	vi.spyOn(Notice.prototype as unknown as { constructor__(): void }, 'constructor__').mockImplementation(function (this: Notice) {
		shown.push({ text: this.messageEl.textContent ?? '', buttons: this.messageEl.querySelectorAll('.pf-pro-notice-sponsor').length });
	});
	return { plugin, tab, save, shown };
}
type Item = { name?: string; control?: { disabled?: () => boolean; key: string }; render?: (s: Setting) => void };
const items = (tab: TaskFieldLabelsSettingTab) => tab.productSettingDefinitions() as unknown as Item[];
function saveButton(tab: TaskFieldLabelsSettingTab): HTMLButtonElement {
	const s = new Setting(createDiv());
	items(tab).find((i) => i.name === 'Save display preset (Pro)')!.render!(s);
	return s.settingEl.querySelector('button')!;
}

describe('Pro rows of the settings tab', () => {
	afterEach(() => { resetPro(); vi.restoreAllMocks(); });

	it('a free user who selects a Pro row gets the Pro notice with a Sponsor button, nothing is saved, and the rows show the values in effect', async () => {
		const { plugin, tab, save, shown } = await setup(false);
		const pro = items(tab).filter((i) => i.name?.endsWith('(Pro)'));
		expect(pro.length).toBe(FIELDS.length + 5);
		for (const i of pro) expect(i.control?.disabled?.() ?? false, i.name).toBe(false);
		const before = JSON.stringify(plugin.settings);
		await tab.setControlValue('label-due', 'Due by');
		await tab.setControlValue('compact', true);
		await tab.setControlValue('selectedPreset', 'Team');
		await tab.setControlValue('folderRules', 'Work|off');
		const b = saveButton(tab);
		expect(b.disabled).toBe(false);
		b.click();
		expect(shown).toEqual([notice(LABELS_LEAD), notice(LABELS_LEAD), notice(PRESETS_LEAD), notice(PRESETS_LEAD), notice(PRESETS_LEAD)]);
		expect(save).not.toHaveBeenCalled();
		expect(JSON.stringify(plugin.settings)).toBe(before);
		expect(tab.update).toHaveBeenCalledTimes(4);
		expect(tab.getControlValue('label-due')).toBe(LABELS.due);
		expect(tab.getControlValue('compact')).toBe(false);
		expect(tab.getControlValue('folderRules')).toBe('');
		// The free row is not a Pro row.
		await tab.setControlValue('enabled', false);
		expect(save).toHaveBeenCalledTimes(1);
		expect(shown).toHaveLength(5);
	});

	it('a Pro user changes a label and saves a preset, with no Pro notice', async () => {
		const { plugin, tab, save, shown } = await setup(true);
		expect(tab.getControlValue('label-due')).toBe('Deadline');
		await tab.setControlValue('label-due', 'Due by');
		expect(plugin.settings.labels.due).toBe('Due by');
		plugin.settings.presetName = 'Team';
		saveButton(tab).click();
		await vi.waitFor(() => { expect(plugin.settings.presets.Team).toBeDefined(); });
		expect(save).toHaveBeenCalled();
		expect(shown.filter((n) => n.buttons > 0)).toEqual([]);
	});
});
