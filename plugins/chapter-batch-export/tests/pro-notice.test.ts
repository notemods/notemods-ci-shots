import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Notice } from 'obsidian-test-mocks/obsidian';
import type { SponsorsManager } from '../src/license/index';
import Plugin from '../src/main';
import { ExportModal } from '../src/modal';
import { bindPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';
vi.mock('obsidian', async (importOriginal) => ({
	...await importOriginal<Record<string, unknown>>(),
	getFrontMatterInfo: vi.fn(() => ({ exists: true, frontmatter: 'test index' })),
	parseYaml: vi.fn(() => ({ longform: { format: 'scenes', sceneFolder: '/', scenes: ['One', 'Two'] } })),
}));

// A free user can select the Pro controls of the export window: the 3 format fields, the preset list and Save preset.
// The select shows the shared Pro notice with the "Sponsor on GitHub" button. No value changes, nothing is saved,
// and the preview and Save chapters stay ready. A Pro user edits the fields and saves the preset as before.
const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';
const LEAD = 'Named presets, chapter ranges and formats need Pro.';

function fakePro(pro: boolean): SponsorsManager {
	return {
		isPro: () => pro,
		onChange: () => () => undefined,
		hasToken: () => false,
		isChecking: () => false,
		getState: () => ({ status: 'unchecked', lastAttemptAt: 0 }),
		config: { sponsorLogin: 'theluckystrike', source: 'chapter-batch-export' },
	} as unknown as SponsorsManager;
}

async function setup(pro: boolean, presets: { name: string; folder: string; range: string; heading: string; filename: string }[] = []) {
	const app = App.createConfigured__({ files: { 'Book/Index.md': '---\nlongform: test\n---\n', 'Book/One.md': 'First.', 'Book/Two.md': 'Second.' } });
	const plugin = new Plugin(app as never, manifest as never);
	await plugin.loadSettings();
	plugin.settings.presets = presets;
	plugin.saveSettings = vi.fn(async () => undefined);
	bindPro(fakePro(pro));
	const shown: { text: string; buttons: number }[] = [];
	vi.spyOn(Notice.prototype as unknown as { constructor__(): void }, 'constructor__').mockImplementation(function (this: Notice) {
		shown.push({ text: this.messageEl.textContent ?? '', buttons: this.messageEl.querySelectorAll('.pf-pro-notice-sponsor').length });
	});
	// The mock Modal.open closes the modal after 0 ms, so the test calls onOpen itself.
	const modal = new ExportModal(plugin, app.vault.getFileByPath('Book/Index.md')! as never);
	modal.onOpen();
	await vi.waitFor(() => { expect(modal.contentEl.querySelector<HTMLElement>('.cbe-message')?.dataset.status).toBe('ready'); });
	return { plugin, modal, shown };
}
const input = (modal: { contentEl: HTMLElement }, key: string) => modal.contentEl.querySelector<HTMLInputElement>(`input[data-field="${key}"]`)!;
const button = (modal: { contentEl: HTMLElement }, text: string) => [...modal.contentEl.querySelectorAll('button')].find((b) => b.textContent === text)!;
const presetSelect = (modal: { contentEl: HTMLElement }) => modal.contentEl.querySelector<HTMLSelectElement>('.cbe-pro select')!;
const notice = { text: `${LEAD} ${PITCH}Sponsor on GitHub`, buttons: 1 };

describe('Pro controls of the export window', () => {
	afterEach(() => { resetPro(); vi.restoreAllMocks(); });

	it('a free user who selects a format field, the preset list or Save preset gets the Pro notice with a Sponsor button, and nothing changes or saves', async () => {
		const { plugin, modal, shown } = await setup(false);
		const save = vi.spyOn(plugin, 'savePreset');
		const before = { ...modal.options };
		for (const key of ['range', 'heading', 'filename']) {
			const el = input(modal, key);
			expect(el.disabled).toBe(false);
			expect(el.readOnly).toBe(true);
			el.click();
			el.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
			expect(input(modal, key).value).toBe(String(before[key as keyof typeof before]));
		}
		const b = button(modal, 'Save preset');
		expect(b.disabled).toBe(false);
		b.click();
		await new Promise((r) => setTimeout(r, 0));
		// One notice for each field click and one for Save preset. A key right after a click in the same field shows no second notice.
		expect(shown).toEqual([notice, notice, notice, notice]);
		expect(save).not.toHaveBeenCalled();
		expect(plugin.saveSettings).not.toHaveBeenCalled();
		expect(plugin.settings.presets).toEqual([]);
		expect(modal.options).toEqual(before);
		expect(modal.contentEl.querySelector<HTMLElement>('.cbe-message')?.dataset.status).toBe('ready');
		expect(modal.contentEl.querySelector<HTMLButtonElement>('.cbe-export')?.disabled).toBe(false);
		modal.close();
	});

	it('a lapsed sponsor who selects a saved preset gets the Pro notice, and the options do not change', async () => {
		const { modal, shown } = await setup(false, [{ name: 'Review', folder: 'Out', range: '2', heading: '', filename: 'x {number}' }]);
		const before = { ...modal.options };
		const s = presetSelect(modal);
		expect(s.disabled).toBe(false);
		s.value = 'Review';
		s.dispatchEvent(new Event('change'));
		expect(shown).toEqual([notice]);
		expect(presetSelect(modal).value).toBe('');
		expect(modal.options).toEqual(before);
		modal.close();
	});

	it('a Pro user edits the range and saves a preset, with no Pro notice', async () => {
		const { plugin, modal, shown } = await setup(true);
		const range = input(modal, 'range');
		expect(range.readOnly).toBe(false);
		range.value = '2'; range.dispatchEvent(new Event('input'));
		expect(modal.options.range).toBe('2');
		const name = modal.contentEl.querySelector<HTMLInputElement>('input[placeholder="Preset name"]')!;
		name.value = 'Review'; name.dispatchEvent(new Event('input'));
		button(modal, 'Save preset').click();
		await vi.waitFor(() => { expect(plugin.saveSettings).toHaveBeenCalled(); });
		expect(plugin.settings.presets.map((p) => p.name)).toEqual(['Review']);
		expect(shown.filter((n) => n.buttons > 0)).toEqual([]);
		modal.close();
	});
});
