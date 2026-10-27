import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Modal, Notice } from 'obsidian-test-mocks/obsidian';
import type { SponsorsManager } from '../src/license/index';
import KanbanDraftVaultPlugin from '../src/main';
import { RecoveryModal } from '../src/recovery';
import { bindPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';

// A free user can select "Retention limits (pro)" and the search field of the recovery window. The select shows the
// shared Pro notice with the "Sponsor on GitHub" button. No limit window opens, the search stays empty and lists all drafts.
const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';
const LIMITS = 'Retention limits need Pro.';
const SEARCH = 'Search across boards needs Pro.';

function fakePro(pro: boolean): SponsorsManager {
	return {
		isPro: () => pro,
		onChange: () => () => undefined,
		hasToken: () => false,
		isChecking: () => false,
		getState: () => ({ status: 'unchecked', lastAttemptAt: 0 }),
		config: { sponsorLogin: 'theluckystrike', source: 'kanban-draft-vault' },
	} as unknown as SponsorsManager;
}

function setup(pro: boolean) {
	bindPro(fakePro(pro));
	const p = new KanbanDraftVaultPlugin(App.createConfigured__({}) as never, manifest as never);
	const at = Date.now();
	p.capture({ id: 'one', board: 'Board A.md', lane: 'Todo', text: 'Call Ana', at });
	p.capture({ id: 'two', board: 'Board B.md', lane: 'Todo', text: 'Book room', at: at + 1 });
	const shown: { text: string; buttons: number }[] = [];
	vi.spyOn(Notice.prototype as unknown as { constructor__(): void }, 'constructor__').mockImplementation(function (this: Notice) {
		shown.push({ text: this.messageEl.textContent ?? '', buttons: this.messageEl.querySelectorAll('.pf-pro-notice-sponsor').length });
	});
	const modal = new RecoveryModal(p);
	modal.onOpen();
	return { p, modal, shown };
}
const limits = (m: RecoveryModal) => [...m.contentEl.querySelectorAll('button')].find((b) => b.textContent === 'Retention limits (pro)')!;
const search = (m: RecoveryModal) => m.contentEl.querySelector<HTMLInputElement>('input[aria-label="Search drafts"]')!;
const count = (m: RecoveryModal) => m.contentEl.querySelectorAll('.kanban-draft-vault-draft').length;

describe('Pro controls of the recovery window', () => {
	afterEach(() => { resetPro(); vi.restoreAllMocks(); document.body.empty(); });

	it('a free user who selects Retention limits or the search field gets the Pro notice with a Sponsor button, and nothing changes', () => {
		const { p, modal, shown } = setup(false);
		const open = vi.spyOn(Modal.prototype, 'open');
		const before = JSON.stringify(p.settings);
		const b = limits(modal);
		expect(b.disabled).toBe(false);
		b.click();
		const s = search(modal);
		expect(s.disabled).toBe(false);
		expect(s.readOnly).toBe(true);
		s.click();
		s.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
		expect(shown).toEqual([
			{ text: `${LIMITS} ${PITCH}Sponsor on GitHub`, buttons: 1 },
			{ text: `${SEARCH} ${PITCH}Sponsor on GitHub`, buttons: 1 },
		]);
		expect(open).not.toHaveBeenCalled();
		expect(search(modal).value).toBe('');
		expect(count(modal)).toBe(2);
		expect(JSON.stringify(p.settings)).toBe(before);
		modal.close();
	});

	it('a Pro user opens Retention limits and searches, with no Pro notice', () => {
		const { modal, shown } = setup(true);
		const open = vi.spyOn(Modal.prototype, 'open').mockImplementation(() => undefined);
		limits(modal).click();
		expect(open).toHaveBeenCalledTimes(1);
		const s = search(modal);
		expect(s.readOnly).toBe(false);
		s.value = 'room'; s.dispatchEvent(new Event('input'));
		expect(count(modal)).toBe(1);
		expect(shown.filter((n) => n.buttons > 0)).toEqual([]);
		modal.close();
	});
});
