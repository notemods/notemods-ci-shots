import { browser, expect } from '@wdio/globals';
import type PocketLetterChordsPlugin from '../../src/main';
import type { SponsorsManager } from '../../src/license/index';

// A free user can select Add dictionary in the settings and Import file in the dictionary window. Each select shows the
// shared Pro notice with the "Sponsor on GitHub" button. No window opens and nothing is saved. A Pro user opens the window.
type Host = { plugins: { plugins: Record<string, PocketLetterChordsPlugin> }; setting: { open(): void; close(): void; openTabById(id: string): void; activeTab?: { containerEl: HTMLElement } } };
const FOLDER = 'Folder dictionaries need Pro.';
const FILES = 'Dictionary files need Pro.';

async function setPro(on: boolean): Promise<boolean> {
	return browser.executeObsidian(async ({ app }, enabled) => {
		const p = (app as unknown as Host).plugins.plugins['pocket-letter-chords']!;
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

async function state() {
	return browser.executeObsidian(async ({ app }) => {
		const p = (app as unknown as Host).plugins.plugins['pocket-letter-chords']!;
		const docs = new Set([activeDocument, document]);
		return {
			notices: [...docs].flatMap((d) => [...d.querySelectorAll('.notice')]).map((n) => ({ text: n.textContent ?? '', sponsor: n.querySelectorAll('.pf-pro-notice-sponsor').length })),
			titles: [...new Set([activeDocument, document])].flatMap((d) => [...d.querySelectorAll('.modal .modal-title')]).map((t) => t.textContent ?? ''),
			dictionary: p.dictionaryModal?.titleEl.textContent ?? null,
			saved: JSON.stringify((await p.loadData()) ?? {}),
		};
	});
}

async function clearNotices(): Promise<void> {
	await browser.executeObsidian(() => { for (const d of new Set([activeDocument, document])) d.querySelectorAll('.notice').forEach((n) => n.remove()); });
}


/** Selects the button of the settings row with this name. Returns null when the row is not drawn, else the disabled state before the click. */
async function pressRow(name: string): Promise<boolean | null> {
	await browser.waitUntil(async () => browser.executeObsidian(({ app }, name) => {
		const root = (app as unknown as Host).setting.activeTab?.containerEl;
		return !!root && [...root.querySelectorAll('.setting-item-name')].some((n) => n.textContent === name);
	}, name), { timeout: 10000, timeoutMsg: `No settings row ${name}` });
	return browser.executeObsidian(({ app }, name) => {
		const root = (app as unknown as Host).setting.activeTab!.containerEl;
		const item = [...root.querySelectorAll<HTMLElement>('.setting-item')].find((r) => r.querySelector('.setting-item-name')?.textContent === name);
		const button = item?.querySelector('button');
		if (!button) return null;
		const disabled = button.disabled;
		button.click();
		return disabled;
	}, name);
}

async function openSettings(): Promise<void> {
	await browser.executeObsidian(({ app }) => { const s = (app as unknown as Host).setting; s.open(); s.openTabById('pocket-letter-chords'); });
	await clearNotices();
}

describe('Pro moments of Pocket Letter Chords', function () {
	afterEach(async () => {
		await browser.executeObsidian(({ app }) => {
			const p = (app as unknown as Host).plugins.plugins['pocket-letter-chords']!;
			p.dictionaryModal?.close();
			(app as unknown as Host).setting.close();
		});
		await setPro(false);
	});

	it('a free user who selects Add dictionary or Import file gets the Pro notice with a Sponsor button, and nothing opens or saves', async () => {
		expect(await setPro(false)).toBe(false);
		const before = await state();
		await openSettings();
		expect(await pressRow('Add folder dictionary')).toBe(false);
		await browser.pause(300);
		const afterAdd = await state();
		if (!afterAdd.notices.some((n) => n.text.includes(FOLDER) && n.sponsor === 1)) throw new Error(`No Pro notice after Add dictionary: ${JSON.stringify(afterAdd.notices)}`);
		expect(afterAdd.titles.filter((t) => t.includes('Folder dictionary'))).toEqual([]);
		await browser.executeObsidian(({ app }) => { (app as unknown as Host).setting.close(); });
		await browser.executeObsidianCommand('pocket-letter-chords:edit-dictionary');
		await clearNotices();
		const importButton = await browser.$('.pocket-letter-chords-dictionary').$('button=Import file');
		await importButton.waitForDisplayed({ timeout: 5000 });
		await importButton.click();
		await browser.pause(300);
		const afterImport = await state();
		if (!afterImport.notices.some((n) => n.text.includes(FILES) && n.sponsor === 1)) throw new Error(`No Pro notice after Import file: ${JSON.stringify(afterImport.notices)}`);
		expect(await browser.$('.pocket-letter-chords-file').isExisting()).toBe(false);
		expect(afterImport.saved).toBe(before.saved);
	});

	it('a Pro user who selects Add dictionary gets the folder dictionary window, with no Pro notice', async () => {
		expect(await setPro(true)).toBe(true);
		await openSettings();
		expect(await pressRow('Add folder dictionary')).toBe(false);
		await browser.pause(300);
		const after = await state();
		if (after.dictionary !== 'Folder dictionary (Pro)') throw new Error(`No folder dictionary window: ${JSON.stringify(after)}`);
		expect(after.notices.filter((n) => n.sponsor > 0)).toEqual([]);
	});
});
