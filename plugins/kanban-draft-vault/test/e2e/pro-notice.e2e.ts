import { browser, expect } from '@wdio/globals';
import type KanbanDraftVaultPlugin from '../../src/main';
import type { SponsorsManager } from '../../src/license/index';

// A free user can select "Retention limits (pro)" and the search field of the recovery window. The select shows the
// shared Pro notice with the "Sponsor on GitHub" button. No limit window opens, the search stays empty and lists all drafts.
type Host = { plugins: { plugins: Record<string, KanbanDraftVaultPlugin> } };
const LIMITS = 'Retention limits need Pro.';
const SEARCH = 'Search across boards needs Pro.';

async function setPro(on: boolean): Promise<boolean> {
	return browser.executeObsidian(async ({ app }, enabled) => {
		const p = (app as unknown as Host).plugins.plugins['kanban-draft-vault']!;
		const pro = p.pro as SponsorsManager;
		if (!enabled) { pro.signOut(); return pro.isPro(); }
		// Synthetic token store and HTTP answer. No network request or Keychain key.
		let token: string | null = 'gho_' + '0'.repeat(36);
		pro.opts.tokens.get = () => token; pro.opts.tokens.set = (v) => { token = v; }; pro.opts.tokens.clear = () => { token = null; };
		pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader', totalSponsorshipAmountAsSponsorInCents: 1500 }, user: { viewerIsSponsoring: true, sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
		await pro.refreshNow();
		return pro.isPro();
	}, on);
}

async function openRecovery(): Promise<void> {
	await browser.executeObsidian(async ({ app }) => {
		activeDocument.querySelectorAll<HTMLElement>('.modal-close-button').forEach((b) => b.click());
		const p = (app as unknown as Host).plugins.plugins['kanban-draft-vault']!;
		const at = Date.now();
		p.capture({ id: 'pro-a', board: 'Board A.md', lane: 'Todo', text: 'Call Ana', at });
		p.capture({ id: 'pro-b', board: 'Board B.md', lane: 'Todo', text: 'Book room', at: at + 1 });
		await p.saves.flush();
		activeDocument.querySelectorAll('.notice').forEach((n) => n.remove());
	});
	// Close a recovery window of an earlier test with Escape, the way a user does.
	for (let i = 0; i < 5 && (await browser.$$('.kanban-draft-vault-modal').length) > 0; i++) { await browser.keys('Escape'); await browser.pause(300); }
	await browser.waitUntil(async () => (await browser.$$('.kanban-draft-vault-modal').length) === 0, { timeout: 5000, timeoutMsg: 'An old recovery window stays open' });
	await browser.executeObsidianCommand('kanban-draft-vault:recover-drafts');
	await browser.$('.kanban-draft-vault-modal').waitForDisplayed({ timeout: 5000 });
}

/** The search field of the open recovery window, and its read-only state. */
async function searchState() {
	return browser.executeObsidian(({ app }) => {
		const field = activeDocument.querySelector<HTMLInputElement>('.kanban-draft-vault-modal input[aria-label="Search drafts"]')!;
		return { readOnly: field.readOnly, pro: ((app as unknown as Host).plugins.plugins['kanban-draft-vault']!.pro as SponsorsManager).isPro() };
	});
}

async function state() {
	return browser.executeObsidian(async ({ app }) => {
		const p = (app as unknown as Host).plugins.plugins['kanban-draft-vault']!;
		return {
			notices: [...activeDocument.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', sponsor: n.querySelectorAll('.pf-pro-notice-sponsor').length })),
			modals: activeDocument.querySelectorAll('.modal').length,
			search: activeDocument.querySelector<HTMLInputElement>('.kanban-draft-vault-modal input[aria-label="Search drafts"]')?.value ?? null,
			drafts: activeDocument.querySelectorAll('.kanban-draft-vault-modal .kanban-draft-vault-draft').length,
			limits: JSON.stringify(p.settings.limits),
		};
	});
}

describe('Pro controls of the recovery window', function () {
	afterEach(async () => {
		for (let i = 0; i < 5 && (await browser.$$('.kanban-draft-vault-modal').length) > 0; i++) { await browser.keys('Escape'); await browser.pause(300); }
		await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as Host).plugins.plugins['kanban-draft-vault']!;
			for (const id of ['pro-a', 'pro-b']) await p.dismiss(id);
		});
		await setPro(false);
	});

	it('a free user who selects Retention limits or the search field gets the Pro notice with a Sponsor button, and nothing changes', async () => {
		expect(await setPro(false)).toBe(false);
		await openRecovery();
		const before = await state();
		const limits = await browser.$('//div[contains(@class,"kanban-draft-vault-modal")]//button[normalize-space(text())="Retention limits (pro)"]');
		expect(await limits.isEnabled()).toBe(true);
		await limits.click();
		await browser.pause(300);
		const afterLimits = await state();
		if (!afterLimits.notices.some((n) => n.text.includes(LIMITS) && n.sponsor === 1)) throw new Error(`No Pro notice after Retention limits: ${JSON.stringify(afterLimits.notices)}`);
		expect(afterLimits.modals).toBe(before.modals);
		expect((await searchState()).readOnly).toBe(true);
		const search = await browser.$('.kanban-draft-vault-modal input[aria-label="Search drafts"]');
		await search.click();
		await browser.keys(['r']);
		await browser.pause(300);
		const after = await state();
		if (!after.notices.some((n) => n.text.includes(SEARCH) && n.sponsor === 1)) throw new Error(`No Pro notice after the search click: ${JSON.stringify(after.notices)}`);
		expect(after.search).toBe('');
		expect(after.drafts).toBe(before.drafts);
		expect(after.limits).toBe(before.limits);
	});

	it('a Pro user who types in the search field filters the list, with no Pro notice', async () => {
		expect(await setPro(true)).toBe(true);
		await openRecovery();
		expect(await searchState()).toEqual({ readOnly: false, pro: true });
		const search = await browser.$('.kanban-draft-vault-modal input[aria-label="Search drafts"]');
		await search.click();
		await browser.keys('Book room'.split(''));
		await browser.pause(300);
		const after = await state();
		expect(after.search).toBe('Book room');
		expect(after.drafts).toBe(1);
		expect(after.notices.filter((n) => n.sponsor > 0)).toEqual([]);
	});
});
