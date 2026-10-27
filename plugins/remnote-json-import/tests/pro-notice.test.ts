import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Notice } from 'obsidian-test-mocks/obsidian';
import type { SponsorsManager } from '../src/license/index';
import RemNoteJsonImportPlugin from '../src/main';
import { ImportModal } from '../src/modal';
import { bindPro, resetPro, PRO_PRESETS, PRO_CHANGES, PRO_SUBTREES } from '../src/pro';
import manifest from '../manifest.json';

// A free user can select the Pro controls of the import window. Each one shows the shared Pro notice with the
// "Sponsor on GitHub" button. No preset is saved, no comparison runs and the subtree roots field stays empty.
const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';
const SOURCE = JSON.stringify({ docs: [{ _id: 'root', key: ['Study plan'], children: ['child'] }, { _id: 'child', parent: 'root', key: ['Practice'] }] });

function fakePro(pro: boolean): SponsorsManager {
	return {
		isPro: () => pro,
		onChange: () => () => undefined,
		hasToken: () => false,
		isChecking: () => false,
		getState: () => ({ status: 'unchecked', lastAttemptAt: 0 }),
		config: { sponsorLogin: 'theluckystrike', source: 'remnote-json-import' },
	} as unknown as SponsorsManager;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function setup(pro: boolean, snapshot: Record<string, string> | null = null) {
	const app = App.createConfigured__({ files: {} });
	const plugin = new RemNoteJsonImportPlugin(app as never, manifest as never);
	await plugin.loadSettings();
	plugin.settings.snapshot = snapshot;
	plugin.saveSettings = vi.fn(async () => undefined);
	bindPro(fakePro(pro));
	const shown: { text: string; buttons: number }[] = [];
	vi.spyOn(Notice.prototype as unknown as { constructor__(): void }, 'constructor__').mockImplementation(function (this: Notice) {
		shown.push({ text: this.messageEl.textContent ?? '', buttons: this.messageEl.querySelectorAll('.pf-pro-notice-sponsor').length });
		// A shown notice is in the document until it hides.
		document.body.append(this.messageEl);
	});
	const modal = new ImportModal(app as never, plugin);
	modal.onOpen();
	modal.text = SOURCE;
	modal.showPreview();
	return { plugin, modal, shown };
}

const button = (modal: ImportModal, text: string) => [...modal.contentEl.querySelectorAll('button')].find((b) => b.textContent === text)!;
const rootsInput = (modal: ImportModal) => [...modal.contentEl.querySelectorAll('.setting-item')]
	.find((r) => r.querySelector('.setting-item-name')?.textContent === 'Pro subtree roots')!.querySelector('input')!;
const count = (modal: ImportModal) => modal.contentEl.querySelector('.remnote-import-count')?.textContent;

describe('Pro controls of the import window', () => {
	afterEach(() => { resetPro(); vi.restoreAllMocks(); document.body.empty(); });

	it('a free user who selects Save preset, Pro change preview or types a subtree root gets the Pro notice with a Sponsor button, and nothing runs or saves', async () => {
		const { plugin, modal, shown } = await setup(false, { root: 'x' });
		const before = JSON.stringify(plugin.settings);
		const previewChanges = vi.spyOn(plugin, 'previewChanges');
		const savePreset = vi.spyOn(plugin, 'savePreset');
		expect(count(modal)).toBe('2 source Rems → 2 notes. 0 warnings.');
		button(modal, 'Save preset').click(); await flush();
		button(modal, 'Pro change preview').click(); await flush();
		const roots = rootsInput(modal);
		expect(roots.disabled).toBe(false);
		roots.value = 'root';
		roots.dispatchEvent(new Event('input'));
		await flush();
		expect(shown).toEqual([
			{ text: `${PRO_PRESETS} ${PITCH}Sponsor on GitHub`, buttons: 1 },
			{ text: `${PRO_CHANGES} ${PITCH}Sponsor on GitHub`, buttons: 1 },
			{ text: `${PRO_SUBTREES} ${PITCH}Sponsor on GitHub`, buttons: 1 },
		]);
		// The field shows its true value: no subtree root.
		expect(roots.value).toBe('');
		expect(modal.layout.groupRoots).toEqual([]);
		expect(savePreset).not.toHaveBeenCalled();
		expect(previewChanges).not.toHaveBeenCalled();
		expect(plugin.saveSettings).not.toHaveBeenCalled();
		expect(JSON.stringify(plugin.settings)).toBe(before);
		// The free preview and the Create notes button stay.
		expect(count(modal)).toBe('2 source Rems → 2 notes. 0 warnings.');
		expect(button(modal, 'Create notes').disabled).toBe(false);
		// More keys while the notice shows give no second notice, and the field stays empty.
		roots.value = 'ro';
		roots.dispatchEvent(new Event('input'));
		expect(shown.length).toBe(3);
		expect(roots.value).toBe('');
		// After the notice hides, the next key shows the notice again.
		document.body.empty();
		roots.value = 'r';
		roots.dispatchEvent(new Event('input'));
		expect(shown.length).toBe(4);
		expect(roots.value).toBe('');
		modal.close();
	});

	it('a Pro user who selects Save preset, Pro change preview and types a subtree root saves, compares and keeps the root', async () => {
		const { plugin, modal, shown } = await setup(true, { root: 'x' });
		const roots = rootsInput(modal);
		roots.value = 'root';
		roots.dispatchEvent(new Event('input'));
		expect(modal.layout.groupRoots).toEqual(['root']);
		button(modal, 'Pro change preview').click(); await flush();
		expect(modal.contentEl.querySelector('.remnote-import-preview')?.textContent).toContain('added,');
		const name = modal.contentEl.querySelector<HTMLInputElement>('input[placeholder="Preset name"]')!;
		name.value = 'Study';
		name.dispatchEvent(new Event('input'));
		button(modal, 'Save preset').click();
		await vi.waitFor(() => { expect(plugin.saveSettings).toHaveBeenCalled(); });
		expect(plugin.settings.presets.map((p) => p.name)).toEqual(['Study']);
		expect(shown.filter((n) => n.buttons > 0)).toEqual([]);
		modal.close();
	});
});
