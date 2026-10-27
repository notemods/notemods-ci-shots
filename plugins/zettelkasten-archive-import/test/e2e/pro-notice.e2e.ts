import { browser, expect } from '@wdio/globals';
import { resolve } from 'node:path';
import type Zkn3ArchiveImportPlugin from '../../src/main';
import type { SponsorsManager } from '../../src/license/index';
import { pluginId } from './load';

// A free user can select the Pro controls of the import window. The select shows the shared Pro notice with the
// "Sponsor on GitHub" button. The tags toggle shows off again, the file name rule stays Position and no rule is saved.
// A Pro user turns the same toggle on.
type Host = { plugins: { plugins: Record<string, Zkn3ArchiveImportPlugin> } };
const RULES = 'Saved keyword and file name rules need Pro.';
const COMPARE = 'The archive comparison needs Pro.';

async function setPro(on: boolean): Promise<boolean> {
	return browser.executeObsidian(async ({ app }, enabled) => {
		const p = (app as unknown as Host).plugins.plugins['zettelkasten-archive-import']!;
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

async function openWindow(): Promise<void> {
	await browser.executeObsidian(() => { activeDocument.querySelectorAll('.notice').forEach((n) => n.remove()); });
	await browser.executeObsidianCommand(`${pluginId}:import-archive`);
	await browser.$('input.zkn3-picker:not(.zkn3-earlier)[type="file"]').setValue(resolve('tests/fixtures/deleted-slot.zkn3'));
	await browser.waitUntil(async () => (await browser.$('.zkn3-status').getText()).includes('Preview ready'), { timeout: 20000, timeoutMsg: 'Import preview did not finish' });
}

/** Selects the tags toggle, the file name rule and Save rules, and returns the control states, the notices and the settings. */
async function select(toggle: boolean, others: boolean) {
	return browser.executeObsidian(async ({ app }, toggle, others) => {
		const root = activeDocument.querySelector('.zkn3-import-modal')!;
		const row = () => [...root.querySelectorAll('.setting-item')].find((r) => r.querySelector('.setting-item-name')?.textContent === 'Also add keywords as tags');
		if (toggle) (row()?.querySelector('.checkbox-container') as HTMLElement | null)?.click();
		const sel = root.querySelector<HTMLSelectElement>('.zkn3-rules select')!;
		if (others) {
			sel.value = 'number-title'; sel.dispatchEvent(new Event('change'));
			[...root.querySelectorAll('button')].find((b) => b.textContent === 'Save rules')?.click();
		}
		await new Promise((r) => setTimeout(r, 300));
		const p = (app as unknown as Host).plugins.plugins['zettelkasten-archive-import']!;
		return {
			on: row()?.querySelector('.checkbox-container')?.classList.contains('is-enabled') ?? null,
			fileName: root.querySelector<HTMLSelectElement>('.zkn3-rules select')?.value ?? '',
			earlierEnabled: !(root.querySelector<HTMLInputElement>('input.zkn3-earlier')?.disabled ?? true),
			notices: [...activeDocument.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', sponsor: n.querySelectorAll('.pf-pro-notice-sponsor').length })),
			settings: JSON.stringify(p.settings),
			saved: JSON.stringify((await p.loadData()) ?? {}),
			preview: root.querySelector('.zkn3-preview')?.textContent ?? '',
		};
	}, toggle, others);
}

describe('Pro controls of the import window', function () {
	afterEach(async () => {
		await browser.executeObsidian(({ app }) => { (app as unknown as Host).plugins.plugins['zettelkasten-archive-import']!.closeImportWindows(); });
		await setPro(false);
	});

	it('a free user who selects a Pro rule, Save rules or an earlier archive gets the Pro notice with a Sponsor button, and nothing changes or saves', async () => {
		expect(await setPro(false)).toBe(false);
		await openWindow();
		const before = await select(false, false);
		const after = await select(true, true);
		await browser.$('input.zkn3-earlier').setValue(resolve('tests/fixtures/deleted-slot.zkn3'));
		const notices = (await select(false, false)).notices;
		for (const lead of [RULES, COMPARE]) {
			if (!notices.some((n) => n.text.includes(lead) && n.sponsor === 1)) throw new Error(`No Pro notice with "${lead}": ${JSON.stringify(notices)}`);
		}
		expect(before.earlierEnabled).toBe(true);
		expect(after.on).toBe(false);
		expect(after.fileName).toBe('number');
		expect(after.settings).toBe(before.settings);
		expect(after.saved).toBe(before.saved);
		expect(after.preview).toBe(before.preview);
		expect(await browser.$('.zkn3-status').getText()).not.toContain('since the earlier archive');
	});

	it('a Pro user who selects Also add keywords as tags turns it on', async () => {
		expect(await setPro(true)).toBe(true);
		await openWindow();
		const after = await select(true, false);
		expect(after.on).toBe(true);
		expect(after.notices.filter((n) => n.sponsor > 0)).toEqual([]);
	});
});
