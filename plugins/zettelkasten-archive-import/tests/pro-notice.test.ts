import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Notice, ToggleComponent } from 'obsidian-test-mocks/obsidian';
import type { SponsorsManager } from '../src/license/index';
import Zkn3ArchiveImportPlugin from '../src/main';
import { readArchive } from '../src/archive';
import { DEFAULT_RULES } from '../src/model';
import { ImportModal } from '../src/modal';
import { bindPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';

// A free user can select the Pro controls of the import window. The select shows the shared Pro notice with the
// "Sponsor on GitHub" button. No rule changes or saves, no earlier archive is read, and each control shows its true value.
const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';
const RULES = 'Saved keyword and file name rules need Pro.';
const COMPARE = 'The archive comparison needs Pro.';
const archiveBytes = () => readFileSync('tests/fixtures/deleted-slot.zkn3');

function fakePro(pro: boolean): SponsorsManager {
	return {
		isPro: () => pro,
		onChange: () => () => undefined,
		hasToken: () => false,
		isChecking: () => false,
		getState: () => ({ status: 'unchecked', lastAttemptAt: 0 }),
		config: { sponsorLogin: 'theluckystrike', source: 'zettelkasten-archive-import' },
	} as unknown as SponsorsManager;
}

const toggles: ToggleComponent[] = [];
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function setup(pro: boolean) {
	const app = App.createConfigured__({ files: {} });
	const plugin = new Zkn3ArchiveImportPlugin(app as never, manifest as never);
	await plugin.loadSettings();
	plugin.saveSettings = vi.fn(async () => undefined);
	bindPro(fakePro(pro));
	const shown: { text: string; buttons: number }[] = [];
	vi.spyOn(Notice.prototype as unknown as { constructor__(): void }, 'constructor__').mockImplementation(function (this: Notice) {
		shown.push({ text: this.messageEl.textContent ?? '', buttons: this.messageEl.querySelectorAll('.pf-pro-notice-sponsor').length });
	});
	vi.spyOn(ToggleComponent.prototype, 'constructor3__').mockImplementation(function (this: ToggleComponent) { toggles.push(this); });
	const modal = new ImportModal(plugin, readArchive(new Uint8Array(archiveBytes())));
	modal.onOpen();
	await vi.waitFor(() => { expect(button(modal, 'Create notes')?.disabled).toBe(false); }, { timeout: 20000 });
	return { plugin, modal, shown };
}

function tagsToggle(modal: ImportModal): ToggleComponent {
	const t = toggles.find((c) => modal.contentEl.contains(c.toggleEl) && c.toggleEl.closest('.setting-item')?.querySelector('.setting-item-name')?.textContent === 'Also add keywords as tags');
	if (!t) throw new Error('No Also add keywords as tags toggle.');
	return t;
}
const button = (modal: ImportModal, text: string) => [...modal.contentEl.querySelectorAll('button')].find((b) => b.textContent === text);
const select = (modal: ImportModal) => modal.contentEl.querySelector<HTMLSelectElement>('.zkn3-rules select')!;
const earlierInput = (modal: ImportModal) => modal.contentEl.querySelector<HTMLInputElement>('input.zkn3-earlier')!;
function chooseEarlier(modal: ImportModal): File {
	const file = new File([archiveBytes()], 'earlier.zkn3');
	const spy = vi.spyOn(file, 'arrayBuffer');
	Object.defineProperty(earlierInput(modal), 'files', { value: [file], configurable: true });
	earlierInput(modal).dispatchEvent(new Event('change'));
	return Object.assign(file, { spy });
}

describe('Pro controls of the import window', () => {
	afterEach(() => { resetPro(); vi.restoreAllMocks(); toggles.length = 0; });

	it('a free user who selects a Pro rule, Save rules or an earlier archive gets the Pro notice with a Sponsor button, and nothing changes or saves', async () => {
		const { plugin, modal, shown } = await setup(false);
		const saveRules = vi.spyOn(plugin, 'saveRules');
		const compare = vi.spyOn(plugin, 'compare');
		const before = JSON.stringify(plugin.settings);
		const preview = modal.contentEl.querySelector('.zkn3-preview')?.textContent;
		const t = tagsToggle(modal);
		expect(t.disabled).toBe(false);
		t.onClick();
		expect(tagsToggle(modal).getValue()).toBe(false);
		expect(select(modal).disabled).toBe(false);
		select(modal).value = 'number-title';
		select(modal).dispatchEvent(new Event('change'));
		expect(select(modal).value).toBe('number');
		expect(button(modal, 'Save rules')?.disabled).toBe(false);
		button(modal, 'Save rules')!.click();
		expect(earlierInput(modal).disabled).toBe(false);
		const file = chooseEarlier(modal) as File & { spy: ReturnType<typeof vi.spyOn> };
		await flush();
		expect(file.spy).not.toHaveBeenCalled();
		expect(earlierInput(modal).value).toBe('');
		expect(shown).toEqual([
			{ text: `${RULES} ${PITCH}Sponsor on GitHub`, buttons: 1 },
			{ text: `${RULES} ${PITCH}Sponsor on GitHub`, buttons: 1 },
			{ text: `${RULES} ${PITCH}Sponsor on GitHub`, buttons: 1 },
			{ text: `${COMPARE} ${PITCH}Sponsor on GitHub`, buttons: 1 },
		]);
		expect(saveRules).not.toHaveBeenCalled();
		expect(compare).not.toHaveBeenCalled();
		expect(plugin.saveSettings).not.toHaveBeenCalled();
		expect(JSON.stringify(plugin.settings)).toBe(before);
		// The free rules stay, and the preview and the Create button stay.
		expect((modal as unknown as { rules: unknown }).rules).toEqual(DEFAULT_RULES);
		expect(modal.contentEl.querySelector('.zkn3-preview')?.textContent).toBe(preview);
		expect(button(modal, 'Create notes')?.disabled).toBe(false);
		modal.close();
	});

	it('a Pro user who selects the Pro rules, Save rules and an earlier archive changes the rules, saves them and compares', async () => {
		const { plugin, modal, shown } = await setup(true);
		tagsToggle(modal).onClick();
		expect(tagsToggle(modal).getValue()).toBe(true);
		select(modal).value = 'number-title';
		select(modal).dispatchEvent(new Event('change'));
		button(modal, 'Save rules')!.click();
		await vi.waitFor(() => { expect(plugin.saveSettings).toHaveBeenCalled(); });
		expect(plugin.settings.rules).toMatchObject({ fileName: 'number-title', keywordTags: true });
		await vi.waitFor(() => { expect(earlierInput(modal).disabled).toBe(false); });
		chooseEarlier(modal);
		await vi.waitFor(() => { expect(modal.contentEl.querySelector('.zkn3-status')?.textContent).toContain('unchanged since the earlier archive'); });
		expect(shown.filter((n) => n.buttons > 0)).toEqual([]);
		modal.close();
	});
});
