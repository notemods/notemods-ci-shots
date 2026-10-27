import { afterEach, describe, expect, it, vi } from 'vitest';
import { Notice } from 'obsidian-test-mocks/obsidian';
import type { SponsorsManager } from '../src/license/index';
import { SceneMoverModal } from '../src/modal';
import { bindPro, resetPro } from '../src/pro';
import { fixture } from './fixtures';

// A free user can select Add move (Pro), Save named order (Pro) and Preview saved order (Pro). The select shows the shared
// Pro notice with the "Sponsor on GitHub" button. The preview, the status line and the saved orders do not change.
const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';
const MOVES = 'More than one move in a preview needs Pro. A single move, preview and backup are free.';
const ORDERS = 'Named manuscript orders need Pro.';
const notice = (lead: string) => ({ text: `${lead} ${PITCH}Sponsor on GitHub`, buttons: 1 });

function fakePro(pro: boolean): SponsorsManager {
	return {
		isPro: () => pro,
		onChange: () => () => undefined,
		hasToken: () => false,
		isChecking: () => false,
		getState: () => ({ status: 'unchecked', lastAttemptAt: 0 }),
		config: { sponsorLogin: 'theluckystrike', source: 'scene-subtree-mover' },
	} as unknown as SponsorsManager;
}

const open: SceneMoverModal[] = [];
async function setup(pro: boolean) {
	const f = fixture(['A', ['a1'], 'B', 'C']);
	bindPro(fakePro(pro));
	const preview = await f.plugin.readPreview(f.file as never);
	f.plugin.settings.orders = [{ name: 'Old ending', indexPath: preview.path, scenes: ['C', 'B', 'A', ['a1']] } as never];
	const saveOrder = vi.spyOn(f.plugin, 'saveOrder');
	const restore = vi.spyOn(f.plugin, 'restoreOrder');
	const shown: { text: string; buttons: number }[] = [];
	vi.spyOn(Notice.prototype as unknown as { constructor__(): void }, 'constructor__').mockImplementation(function (this: Notice) {
		shown.push({ text: this.messageEl.textContent ?? '', buttons: this.messageEl.querySelectorAll('.pf-pro-notice-sponsor').length });
	});
	const modal = new SceneMoverModal(f.app as never, f.plugin, preview, vi.fn());
	open.push(modal); document.body.append(modal.containerEl); modal.onOpen();
	return { ...f, modal, preview, shown, saveOrder, restore };
}
const button = (m: SceneMoverModal, action: string) => m.contentEl.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
const status = (m: SceneMoverModal) => m.contentEl.querySelector('.ssm-status')?.textContent;
const after = (m: SceneMoverModal) => m.contentEl.querySelector('[data-tree="after"]')?.textContent;
function select(m: SceneMoverModal, field: string, value: string) {
	const el = m.contentEl.querySelector<HTMLSelectElement>(`[data-field="${field}"]`)!;
	el.value = value; el.dispatchEvent(new Event('change', { bubbles: true }));
}
async function press(m: SceneMoverModal, action: string) {
	button(m, action).click();
	await vi.waitFor(() => expect(m.contentEl.querySelector('.ssm-status')?.getAttribute('data-pending')).toBe('false'));
}

describe('Pro controls of the mover window', () => {
	afterEach(() => { for (const m of open.splice(0)) { m.close(); m.containerEl.remove(); } resetPro(); vi.restoreAllMocks(); });

	it('a free user who selects Add move, Save named order or Preview saved order gets the Pro notice with a Sponsor button, and nothing changes', async () => {
		const { modal, shown, saveOrder, restore, plugin } = await setup(false);
		select(modal, 'position', '2');
		await press(modal, 'preview');
		const tree = after(modal);
		const line = status(modal);
		expect(shown).toEqual([]);
		for (const action of ['preview', 'save', 'restore']) {
			const b = button(modal, action);
			expect(b.disabled, action).toBe(false);
			b.click();
		}
		expect(shown).toEqual([notice(MOVES), notice(ORDERS), notice(ORDERS)]);
		expect(after(modal)).toBe(tree);
		expect(status(modal)).toBe(line);
		expect(saveOrder).not.toHaveBeenCalled();
		expect(restore).not.toHaveBeenCalled();
		expect(plugin.settings.orders.map((o) => o.name)).toEqual(['Old ending']);
	});

	it('a Pro user adds a second move and saves a named order, with no Pro notice', async () => {
		const { modal, shown, plugin } = await setup(true);
		plugin.saveSettings = vi.fn(async () => undefined);
		select(modal, 'position', '2');
		await press(modal, 'preview');
		select(modal, 'position', '1');
		await press(modal, 'preview');
		expect(status(modal)).toContain('2 moves');
		const name = modal.contentEl.querySelector<HTMLInputElement>('[data-field="order-name"]')!;
		name.value = 'Draft two'; name.dispatchEvent(new Event('input'));
		await press(modal, 'save');
		expect(plugin.settings.orders.map((o) => o.name)).toContain('Draft two');
		expect(shown.filter((n) => n.buttons > 0)).toEqual([]);
	});
});
