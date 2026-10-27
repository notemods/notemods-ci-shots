import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import type RelativeImageWidthPlugin from '../../src/main';
import type { SponsorsManager } from '../../src/license/index';

// A free user can select Default image size, and can set the image-width property in the open note. Both show the
// shared Pro notice with the "Sponsor on GitHub" button. Nothing is saved. A Pro user saves a default size.
type Host = { plugins: { plugins: Record<string, RelativeImageWidthPlugin> }; setting: { open(): void; close(): void; openTabById(id: string): void; activeTab?: { containerEl: HTMLElement } } };
const SIZE = 'A default image size needs Pro.';
const PROPERTY = 'The image-width note property needs Pro.';

async function setPro(on: boolean): Promise<boolean> {
	return browser.executeObsidian(async ({ app }, enabled) => {
		const p = (app as unknown as Host).plugins.plugins['relative-image-width']!;
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

const clearNotices = () => browser.executeObsidian(() => { (window as unknown as { activeWindow: Window }).activeWindow.document.querySelectorAll('.notice').forEach((n) => n.remove()); });

/** Types a key in Default image size of the settings tab. Returns the disabled state before and the value after. */
async function typeSize(): Promise<{ disabled: boolean; value: string }> {
	await browser.executeObsidian(({ app }) => { const s = (app as unknown as Host).setting; s.open(); s.openTabById('relative-image-width'); });
	await clearNotices();
	const disabled = await browser.executeObsidian(({ app }) => {
		const root = (app as unknown as Host).setting.activeTab!.containerEl;
		const item = [...root.querySelectorAll<HTMLElement>('.setting-item')].find((r) => r.querySelector('.setting-item-name')?.textContent === 'Default image size')!;
		const text = item.querySelector<HTMLInputElement>('input')!;
		const was = text.disabled;
		text.focus(); text.value = '50%'; text.dispatchEvent(new Event('input', { bubbles: true })); text.dispatchEvent(new Event('change', { bubbles: true }));
		return was;
	});
	await browser.pause(400);
	const value = await browser.executeObsidian(({ app }) => {
		const root = (app as unknown as Host).setting.activeTab!.containerEl;
		const item = [...root.querySelectorAll<HTMLElement>('.setting-item')].find((r) => r.querySelector('.setting-item-name')?.textContent === 'Default image size')!;
		return item.querySelector<HTMLInputElement>('input')!.value;
	});
	return { disabled, value };
}

async function state() {
	return browser.executeObsidian(async ({ app }) => {
		const p = (app as unknown as Host).plugins.plugins['relative-image-width']!;
		return {
			notices: [...(window as unknown as { activeWindow: Window }).activeWindow.document.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', sponsor: n.querySelectorAll('.pf-pro-notice-sponsor').length })),
			saved: JSON.stringify((await p.loadData()) ?? {}),
			size: p.settings.defaultSize,
		};
	});
}

describe('Pro moments of Relative Image Width', function () {
	afterEach(async () => {
		await setPro(false);
		await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as Host).plugins.plugins['relative-image-width']!;
			p.settings.defaultSize = ''; await p.saveSettings();
			(app as unknown as Host).setting.close();
		});
	});

	it('a free user who types a Default image size or sets image-width in the open note gets the Pro notice with a Sponsor button, and nothing is saved', async () => {
		expect(await setPro(false)).toBe(false);
		const before = await state();
		const typed = await typeSize();
		expect(typed.disabled).toBe(false);
		expect(typed.value).toBe('');
		const afterSize = await state();
		if (!afterSize.notices.some((n) => n.text.includes(SIZE) && n.sponsor === 1)) throw new Error(`No Pro notice after the size: ${JSON.stringify(afterSize.notices)}`);
		expect(afterSize.saved).toBe(before.saved);
		await browser.executeObsidian(({ app }) => { (app as unknown as Host).setting.close(); });
		await obsidianPage.write('Pro width.md', '# Width\n');
		await obsidianPage.openFile('Pro width.md');
		await clearNotices();
		await browser.executeObsidian(async ({ app }) => {
			const f = app.vault.getFileByPath('Pro width.md')!;
			await app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => { fm['image-width'] = '50%'; });
		});
		await browser.waitUntil(async () => (await state()).notices.some((n) => n.text.includes(PROPERTY) && n.sponsor === 1), { timeout: 10000, timeoutMsg: 'No Pro notice after the image-width property' });
		expect((await state()).saved).toBe(before.saved);
	});

	it('a Pro user who types a Default image size saves it, with no Pro notice', async () => {
		expect(await setPro(true)).toBe(true);
		const typed = await typeSize();
		expect(typed.value).toBe('50%');
		const after = await state();
		expect(after.size).toBe('50%');
		expect(after.notices.filter((n) => n.sponsor > 0)).toEqual([]);
	});
});
