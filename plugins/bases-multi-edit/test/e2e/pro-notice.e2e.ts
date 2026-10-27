import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import type BasesMultiEditPlugin from '../../src/main';
import type { SponsorsManager } from '../../src/license/index';

// A free user can select Save action in the edit dialog. The select shows the shared Pro notice with the
// "Sponsor on GitHub" button and saves nothing. A second free apply drops the earlier undo batch and says so.
// A Pro user saves the action with no Pro notice.
type Host = { plugins: { plugins: Record<string, BasesMultiEditPlugin> } };
const ID = 'bases-multi-edit';
const SAVE_LEAD = 'Saved bulk actions need Pro.';
const UNDO_LEAD = 'Undo of more than one batch needs Pro.';
const folder = 'Pro notice checks';
const note = `${folder}/Gamma.md`;

async function setPro(on: boolean): Promise<boolean> {
	return browser.executeObsidian(async ({ app }, enabled) => {
		const p = (app as unknown as Host).plugins.plugins['bases-multi-edit']!;
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

async function openDialog(): Promise<void> {
	await browser.executeObsidian(({ app }) => {
		const p = (app as unknown as Host).plugins.plugins['bases-multi-edit']!;
		for (const d of p.dialogs) d.close();
		p.history = [];
	});
	await obsidianPage.write(note, '---\nstatus: todo\n---\nBody.');
	await obsidianPage.write(`${folder}/Pro.base`, `filters:\n  and:\n    - 'file.inFolder("${folder}")'\nviews:\n  - type: bases-multi-edit\n    name: Pro\n    order:\n      - note.status\n`);
	await obsidianPage.openFile(`${folder}/Pro.base`);
	await browser.waitUntil(async () => browser.execute((label: string) => {
		const input = [...document.querySelectorAll<HTMLInputElement>(`.bme-table-view input[aria-label="Select ${label}"]`)].find((e) => e.offsetParent !== null);
		if (!input) return false;
		if (!input.checked) input.click();
		const edit = [...input.closest('.bme-table-view')!.querySelectorAll('button')].find((b) => b.textContent === 'Edit selected');
		if (!input.checked || !edit || edit.disabled) return false;
		edit.click();
		return true;
	}, note), { timeout: 15000, timeoutMsg: 'The edit dialog did not open' });
	await browser.$('.bme-preview').waitForExist({ timeout: 5000 });
	await browser.executeObsidian(() => { activeDocument.querySelectorAll('.notice').forEach((n) => n.remove()); });
}

/** Selects the dialog button with this label (and sets Value first), then returns the notices, the saved data and the note. */
async function press(label: string, value: string | null = null) {
	return browser.executeObsidian(async ({ app }, label, value, path) => {
		const modal = activeDocument.querySelector('.bme-preview')!.closest('.modal')!;
		if (value !== null) {
			const area = [...modal.querySelectorAll('.setting-item')].find((r) => r.querySelector('.setting-item-name')?.textContent === 'Value')!.querySelector('textarea')!;
			area.value = value; area.dispatchEvent(new Event('input', { bubbles: true }));
		}
		const button = [...modal.querySelectorAll('button')].find((b) => b.textContent === label || (label === 'Apply' && b.textContent?.startsWith('Apply to')));
		if (!button) throw new Error(`Missing button ${label}`);
		button.click();
		await new Promise((r) => setTimeout(r, 600));
		const p = (app as unknown as Host).plugins.plugins['bases-multi-edit']!;
		const f = app.vault.getFileByPath(path)!;
		return {
			notices: [...activeDocument.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', sponsor: n.querySelectorAll('.pf-pro-notice-sponsor').length })),
			actions: p.settings.actions.length,
			saved: JSON.stringify((await p.loadData()) ?? {}),
			history: p.history.length,
			note: await app.vault.read(f),
			preview: modal.querySelector('.bme-preview')?.textContent ?? '',
		};
	}, label, value, note);
}

describe('Pro moments of the edit dialog', function () {
	afterEach(async () => {
		await browser.executeObsidian(({ app }) => { for (const d of (app as unknown as Host).plugins.plugins['bases-multi-edit']!.dialogs) d.close(); });
		await setPro(false);
	});

	it('a free user who selects Save action gets the Pro notice with a Sponsor button and nothing is saved; a second apply says that the earlier batch can no longer be undone', async () => {
		expect(await setPro(false)).toBe(false);
		await openDialog();
		const before = await press('Preview changes');
		const save = await press('Save action');
		if (!save.notices.some((n) => n.text.includes(SAVE_LEAD) && n.sponsor === 1)) throw new Error(`No Pro notice after Save action: ${JSON.stringify(save.notices)}`);
		expect(save.actions).toBe(0);
		expect(save.saved).toBe(before.saved);
		const first = await press('Apply');
		expect(first.note).toContain('status: done');
		expect(first.notices.filter((n) => n.text.includes(UNDO_LEAD)).length).toBe(0);
		await press('Preview changes', 'later');
		const second = await press('Apply');
		expect(second.note).toContain('status: later');
		if (!second.notices.some((n) => n.text.includes(UNDO_LEAD) && n.sponsor === 1)) throw new Error(`No Pro notice after the second apply: ${JSON.stringify(second.notices)}`);
		expect(second.history).toBe(1);
	});

	it('a Pro user who selects Save action saves it, with no Pro notice', async () => {
		expect(await setPro(true)).toBe(true);
		await openDialog();
		const save = await press('Save action');
		expect(save.actions).toBe(1);
		expect(save.preview).toContain('Action saved.');
		expect(save.notices.filter((n) => n.sponsor > 0)).toEqual([]);
		await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as Host).plugins.plugins['bases-multi-edit']!;
			p.settings.actions = []; await p.saveData(p.settings);
		});
	});
});
