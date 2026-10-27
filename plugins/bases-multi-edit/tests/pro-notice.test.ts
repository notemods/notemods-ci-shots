import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Notice } from 'obsidian-test-mocks/obsidian';
import type { SponsorsManager } from '../src/license/index';
import BasesMultiEditPlugin from '../src/main';
import type { Action, Change } from '../src/edit';
import { EditModal } from '../src/view';
import { bindPro } from '../src/pro';

// A free user can select Save action in the edit dialog. The select shows the shared Pro notice with the
// "Sponsor on GitHub" button and saves nothing. A free apply that drops the earlier undo batch says so with the same notice.
const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';
const SAVE_LEAD = 'Saved bulk actions need Pro.';
const UNDO_LEAD = 'Undo of more than one batch needs Pro. The earlier batch can no longer be undone.';
const a: Action = { property: 'status', operation: 'set', type: 'text', input: 'done' };
const change = (path: string): Change => ({ path, before: { exists: true, value: 'todo' }, after: { exists: true, value: 'done' } });

function fakePro(pro: boolean): SponsorsManager {
	return {
		isPro: () => pro,
		onChange: () => () => undefined,
		hasToken: () => false,
		isChecking: () => false,
		getState: () => ({ status: 'unchecked', lastAttemptAt: 0 }),
		config: { sponsorLogin: 'theluckystrike', source: 'bases-multi-edit' },
	} as unknown as SponsorsManager;
}

function setup(pro: boolean, actions: Action[] = []) {
	const app = App.createConfigured__({ files: {} });
	const host = { app, settings: { actions: [...actions] }, history: [], busy: false, stopped: false, dialogs: new Set(), saveData: vi.fn(async () => undefined), store: () => ({ update: async (_p: string, cb: (d: Record<string, unknown>) => void) => cb({ status: 'todo' }) }) };
	const plugin = Object.assign(Object.create(BasesMultiEditPlugin.prototype), host) as BasesMultiEditPlugin;
	bindPro(fakePro(pro));
	const shown: { text: string; buttons: number }[] = [];
	vi.spyOn(Notice.prototype as unknown as { constructor__(): void }, 'constructor__').mockImplementation(function (this: Notice) {
		shown.push({ text: this.messageEl.textContent ?? '', buttons: this.messageEl.querySelectorAll('.pf-pro-notice-sponsor').length });
	});
	const modal = new EditModal(app as never, plugin, ['a.md']);
	modal.onOpen();
	return { plugin, modal, shown };
}
const button = (modal: EditModal, text: string) => [...modal.contentEl.querySelectorAll('button')].find((b) => b.textContent === text);
const select = (modal: EditModal) => [...modal.contentEl.querySelectorAll('.setting-item')].find((r) => r.querySelector('.setting-item-name')?.textContent === 'Saved action')?.querySelector('select');

describe('Pro moments of Bases Multi-Row Edit', () => {
	afterEach(() => { bindPro(null); vi.restoreAllMocks(); });

	it('a free user who selects Save action gets the Pro notice with a Sponsor button, and nothing is saved', async () => {
		const { plugin, modal, shown } = setup(false);
		const save = vi.spyOn(plugin, 'saveAction');
		const b = button(modal, 'Save action');
		expect(b).toBeDefined();
		expect(b!.disabled).toBe(false);
		b!.click();
		await new Promise((r) => setTimeout(r, 0));
		expect(shown).toEqual([{ text: `${SAVE_LEAD} ${PITCH}Sponsor on GitHub`, buttons: 1 }]);
		expect(save).not.toHaveBeenCalled();
		expect(plugin.saveData).not.toHaveBeenCalled();
		expect(plugin.settings.actions).toEqual([]);
		expect(modal.contentEl.querySelector('.bme-preview')?.textContent).toBe('');
		// A user who never had Pro has no saved action, so no empty picker shows.
		expect(select(modal)).toBeUndefined();
		modal.close();
	});

	it('a lapsed sponsor who selects a saved action gets the Pro notice, and the form does not change', () => {
		const saved: Action = { property: 'tags', operation: 'append', type: 'list', input: '["x"]' };
		const { modal, shown } = setup(false, [saved]);
		const s = select(modal)!;
		expect(s.disabled).toBe(false);
		s.value = '0';
		s.dispatchEvent(new Event('change'));
		expect(shown).toEqual([{ text: `${SAVE_LEAD} ${PITCH}Sponsor on GitHub`, buttons: 1 }]);
		expect(modal.action).toEqual(a);
		expect(select(modal)!.value).toBe('');
		modal.close();
	});

	it('a free apply that drops the earlier undo batch shows the Pro notice; the first apply shows none', async () => {
		const { plugin, shown } = setup(false);
		await plugin.apply(a, [change('1.md')]);
		expect(shown).toEqual([]);
		await plugin.apply(a, [change('2.md')]);
		expect(shown).toEqual([{ text: `${UNDO_LEAD} ${PITCH}Sponsor on GitHub`, buttons: 1 }]);
		expect(plugin.history.map((b) => b.changes[0]!.path)).toEqual(['2.md']);
	});

	it('a Pro user saves the action, loads it from the picker and keeps 2 undo batches, with no Pro notice', async () => {
		const { plugin, modal, shown } = setup(true);
		button(modal, 'Save action')!.click();
		await vi.waitFor(() => { expect(plugin.saveData).toHaveBeenCalled(); });
		expect(plugin.settings.actions).toEqual([a]);
		modal.form();
		const s = select(modal)!;
		s.value = '0';
		s.dispatchEvent(new Event('change'));
		expect(modal.action).toEqual(a);
		await plugin.apply(a, [change('1.md')]);
		await plugin.apply(a, [change('2.md')]);
		expect(plugin.history).toHaveLength(2);
		expect(shown).toEqual([]);
		modal.close();
	});
});
