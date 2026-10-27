import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Notice, Setting } from 'obsidian-test-mocks/obsidian';
import type { SponsorsManager } from '../src/license/index';
import type { SettingDefinitionItem } from 'obsidian';
import PocketLetterChordsPlugin from '../src/main';
import { normalizeSettings } from '../src/chords';
import { DictionaryModal } from '../src/modal';
import { PocketLetterChordsSettingTab } from '../src/settings';
import { bindPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';

// A free user can select Add dictionary, Edit dictionary of a folder dictionary, Import file and Export file, and can
// save three-letter chords. Each select shows the shared Pro notice with the "Sponsor on GitHub" button. Nothing opens or saves.
const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';
const FOLDER = 'Folder dictionaries need Pro.';
const FILES = 'Dictionary files need Pro.';
const THREE = 'Three-letter chords need Pro.';
const notice = (lead: string) => ({ text: `${lead} ${PITCH}Sponsor on GitHub`, buttons: 1 });

function fakePro(pro: boolean): SponsorsManager {
	return {
		isPro: () => pro,
		onChange: () => () => undefined,
		hasToken: () => false,
		isChecking: () => false,
		getState: () => ({ status: 'unchecked', lastAttemptAt: 0 }),
		config: { sponsorLogin: 'theluckystrike', source: 'pocket-letter-chords' },
	} as unknown as SponsorsManager;
}

function setup(pro: boolean) {
	const app = App.createConfigured__({ files: {} });
	const plugin = new PocketLetterChordsPlugin(app as never, manifest as never);
	plugin.settings = normalizeSettings({ dictionaries: [{ name: 'Default', folder: '', bindings: [{ keys: 'qw', text: 'Done' }] }, { name: 'Work', folder: 'work', bindings: [{ keys: 'as', text: 'Hi' }] }] });
	plugin.saveSettings = vi.fn(async () => undefined);
	bindPro(fakePro(pro));
	const shown: { text: string; buttons: number }[] = [];
	vi.spyOn(Notice.prototype as unknown as { constructor__(): void }, 'constructor__').mockImplementation(function (this: Notice) {
		shown.push({ text: this.messageEl.textContent ?? '', buttons: this.messageEl.querySelectorAll('.pf-pro-notice-sponsor').length });
	});
	const open = vi.spyOn(plugin, 'openDictionary').mockImplementation(() => undefined);
	return { app, plugin, shown, open };
}

/** Draws the settings row with this name and returns its button. */
function settingsButton(app: App, plugin: PocketLetterChordsPlugin, name: string): HTMLButtonElement {
	const tab = new PocketLetterChordsSettingTab(app as never, plugin);
	const items = tab.productSettingDefinitions().flatMap((d: SettingDefinitionItem) => ('items' in d ? d.items : [d])) as { name?: string; render?: (s: Setting) => void }[];
	const item = items.find((i) => i.name === name)!;
	const setting = new Setting(createDiv());
	item.render!(setting);
	return setting.settingEl.querySelector('button')!;
}
const modalButton = (m: DictionaryModal, text: string) => [...m.contentEl.querySelectorAll('button')].find((b) => b.textContent === text)!;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('Pro moments of Pocket Letter Chords', () => {
	afterEach(() => { resetPro(); vi.restoreAllMocks(); });

	it('a free user who selects Add dictionary or Edit dictionary of a folder dictionary gets the Pro notice, and no window opens', () => {
		const { app, plugin, shown, open } = setup(false);
		for (const name of ['Add folder dictionary', 'Work']) {
			const b = settingsButton(app as never, plugin, name);
			expect(b.disabled).toBe(false);
			b.click();
		}
		expect(shown).toEqual([notice(FOLDER), notice(FOLDER)]);
		expect(open).not.toHaveBeenCalled();
	});

	it('a free user who selects Import file, Export file or saves a three-letter chord gets the Pro notice, and nothing is saved', async () => {
		const { plugin, shown } = setup(false);
		const modal = new DictionaryModal(plugin, 0);
		modal.onOpen();
		const before = JSON.stringify(plugin.settings);
		for (const name of ['Import file', 'Export file']) {
			const b = modalButton(modal, name);
			expect(b.disabled).toBe(false);
			b.click();
		}
		expect(modal.contentEl.querySelector('.pocket-letter-chords-file')).toBeNull();
		const area = modal.contentEl.querySelector<HTMLTextAreaElement>('textarea[aria-label="Chord rows"]')!;
		area.value = '[{"keys":"qwe","text":"Three"}]'; area.dispatchEvent(new Event('input'));
		modalButton(modal, 'Save').click();
		await flush();
		expect(shown).toEqual([notice(FILES), notice(FILES), notice(THREE)]);
		expect(modal.contentEl.querySelector('.pocket-letter-chords-error')?.textContent).toBe(THREE);
		expect(plugin.saveSettings).not.toHaveBeenCalled();
		expect(JSON.stringify(plugin.settings)).toBe(before);
		modal.close();
	});

	it('a Pro user adds a dictionary, starts an import and saves a three-letter chord, with no Pro notice', async () => {
		const { app, plugin, shown, open } = setup(true);
		settingsButton(app as never, plugin, 'Add folder dictionary').click();
		expect(open).toHaveBeenCalledWith(-1);
		const modal = new DictionaryModal(plugin, 0);
		modal.onOpen();
		const pick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
		modalButton(modal, 'Import file').click();
		expect(pick).toHaveBeenCalled();
		const area = modal.contentEl.querySelector<HTMLTextAreaElement>('textarea[aria-label="Chord rows"]')!;
		area.value = '[{"keys":"qwe","text":"Three"}]'; area.dispatchEvent(new Event('input'));
		modalButton(modal, 'Save').click();
		await vi.waitFor(() => { expect(plugin.saveSettings).toHaveBeenCalled(); });
		expect(plugin.settings.dictionaries[0]!.bindings).toEqual([{ keys: 'eqw', text: 'Three' }]);
		expect(shown.filter((n) => n.buttons > 0)).toEqual([]);
	});
});
