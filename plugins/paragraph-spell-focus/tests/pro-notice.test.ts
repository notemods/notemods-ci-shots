import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Notice } from 'obsidian-test-mocks/obsidian';
import type { SponsorsManager } from '../src/license/index';
import ParagraphSpellFocusPlugin from '../src/main';
import { ParagraphSpellFocusSettingTab } from '../src/settings';
import { PRO_RULES, PRO_SCOPE } from '../src/pro';
import manifest from '../manifest.json';

// A free user can select the Pro settings. Each one shows the shared Pro notice with the "Sponsor on GitHub" button.
// Nothing is saved, and the control shows the value in effect without Pro.
const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';

function fakePro(pro: boolean): SponsorsManager {
	return {
		isPro: () => pro,
		onChange: () => () => undefined,
		hasToken: () => false,
		isChecking: () => false,
		getState: () => ({ status: 'unchecked', lastAttemptAt: 0 }),
		config: { sponsorLogin: 'theluckystrike', source: 'paragraph-spell-focus' },
	} as unknown as SponsorsManager;
}

type Def = { name?: string; control?: { key: string; disabled?: () => boolean }; render?: (s: unknown) => void };

async function setup(pro: boolean) {
	const app = App.createConfigured__({ files: {} });
	const plugin = new ParagraphSpellFocusPlugin(app as never, manifest as never);
	await plugin.loadSettings();
	plugin.pro = fakePro(pro);
	plugin.saveSettings = vi.fn(async () => undefined);
	const shown: { text: string; buttons: number }[] = [];
	vi.spyOn(Notice.prototype as unknown as { constructor__(): void }, 'constructor__').mockImplementation(function (this: Notice) {
		shown.push({ text: this.messageEl.textContent ?? '', buttons: this.messageEl.querySelectorAll('.pf-pro-notice-sponsor').length });
		// A shown notice is in the document until it hides.
		document.body.append(this.messageEl);
	});
	const tab = new ParagraphSpellFocusSettingTab(app as never, plugin);
	const update = vi.spyOn(tab, 'update').mockImplementation(() => undefined);
	return { plugin, tab, shown, update };
}

/** Draws the Folder rules row into a new element through its render item, and returns the text area. */
function rulesArea(tab: ParagraphSpellFocusSettingTab): HTMLTextAreaElement {
	const def = (tab.getSettingDefinitions() as Def[]).find((d) => d.name === 'Folder rules (Pro)')!;
	const el = document.createElement('div');
	const { Setting } = require('obsidian-test-mocks/obsidian') as typeof import('obsidian-test-mocks/obsidian');
	def.render!(new Setting(el));
	return el.querySelector('textarea')!;
}

describe('Pro settings', () => {
	afterEach(() => { vi.restoreAllMocks(); document.body.empty(); });

	it('a free user who selects Focus scope or types a folder rule gets the Pro notice with a Sponsor button, nothing is saved, and the controls show the value in effect', async () => {
		const { plugin, tab, shown, update } = await setup(false);
		// A lapsed sponsor keeps saved Pro values.
		plugin.settings.scope = 'section';
		plugin.settings.rules = [{ folder: 'Drafts', scope: 'off' }];
		const before = JSON.stringify(plugin.settings);
		const scope = (tab.getSettingDefinitions() as Def[]).find((d) => d.control?.key === 'scope')!;
		expect(scope.control!.disabled?.() ?? false).toBe(false);
		expect(tab.getControlValue('scope')).toBe('paragraph');
		await tab.setControlValue('scope', 'section');
		expect(update).toHaveBeenCalledOnce();
		const area = rulesArea(tab);
		expect(area.disabled).toBe(false);
		expect(area.value).toBe('');
		document.body.empty();
		area.value = 'Drafts=section';
		area.dispatchEvent(new Event('input'));
		expect(area.value).toBe('');
		expect(shown).toEqual([
			{ text: `${PRO_SCOPE} ${PITCH}Sponsor on GitHub`, buttons: 1 },
			{ text: `${PRO_RULES} ${PITCH}Sponsor on GitHub`, buttons: 1 },
		]);
		// More keys while the notice shows give no second notice.
		area.value = 'D';
		area.dispatchEvent(new Event('input'));
		expect(shown.length).toBe(2);
		expect(plugin.saveSettings).not.toHaveBeenCalled();
		expect(JSON.stringify(plugin.settings)).toBe(before);
	});

	it('a Pro user who selects Focus scope and types a folder rule saves them, with no Pro notice', async () => {
		const { plugin, tab, shown } = await setup(true);
		// The Obsidian base setControlValue writes plugin.settings; the test mock does not, so check the call.
		const base = vi.spyOn(Object.getPrototypeOf(ParagraphSpellFocusSettingTab.prototype) as { setControlValue(k: string, v: unknown): Promise<void> }, 'setControlValue');
		await tab.setControlValue('scope', 'section');
		expect(base).toHaveBeenCalledWith('scope', 'section');
		expect(plugin.saveSettings).toHaveBeenCalledOnce();
		const area = rulesArea(tab);
		area.value = 'Drafts=off';
		area.dispatchEvent(new Event('input'));
		await vi.waitFor(() => { expect(plugin.settings.rules).toEqual([{ folder: 'Drafts', scope: 'off' }]); });
		expect(shown).toEqual([]);
	});
});
