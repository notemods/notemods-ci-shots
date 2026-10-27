import { browser, expect } from '@wdio/globals';
import type ChapterBatchExportPlugin from '../../src/main';
import type { SponsorsManager } from '../../src/license/index';

// A free user can select the Pro controls of the export window. A click on a format field or on Save preset shows the
// shared Pro notice with the "Sponsor on GitHub" button. No option changes and nothing is saved. A Pro user types a range.
type Host = { plugins: { plugins: Record<string, ChapterBatchExportPlugin> } };
const LEAD = 'Named presets, chapter ranges and formats need Pro.';

async function setPro(on: boolean): Promise<boolean> {
	return browser.executeObsidian(async ({ app }, enabled) => {
		const p = (app as unknown as Host).plugins.plugins['chapter-batch-export']!;
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
	await browser.executeObsidian(async ({ app }) => {
		const p = (app as unknown as Host).plugins.plugins['chapter-batch-export']!;
		for (const m of [...p.modals]) m.close();
		const file = app.vault.getFileByPath('Chapter Batch Export/Manuscript.md')!;
		p.openExport(file);
		activeDocument.querySelectorAll('.notice').forEach((n) => n.remove());
		activeDocument.querySelector<HTMLDetailsElement>('.chapter-batch-export-modal details.cbe-pro')!.open = true;
	});
	await browser.waitUntil(async () => (await browser.$('.chapter-batch-export-modal .cbe-message').getAttribute('data-status')) === 'ready', { timeout: 20000, timeoutMsg: 'The preview did not get ready' });
}

async function state() {
	return browser.executeObsidian(async ({ app }) => {
		const p = (app as unknown as Host).plugins.plugins['chapter-batch-export']!;
		const root = activeDocument.querySelector('.chapter-batch-export-modal')!;
		return {
			notices: [...activeDocument.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', sponsor: n.querySelectorAll('.pf-pro-notice-sponsor').length })),
			range: root.querySelector<HTMLInputElement>('input[data-field="range"]')!.value,
			options: JSON.stringify([...p.modals][0]?.options ?? null),
			saved: JSON.stringify((await p.loadData()) ?? {}),
			presets: p.settings.presets.length,
			status: root.querySelector<HTMLElement>('.cbe-message')!.dataset.status,
			exportDisabled: root.querySelector<HTMLButtonElement>('.cbe-export')!.disabled,
		};
	});
}

describe('Pro controls of the export window', function () {
	afterEach(async () => {
		await browser.executeObsidian(({ app }) => { for (const m of [...(app as unknown as Host).plugins.plugins['chapter-batch-export']!.modals]) m.close(); });
		await setPro(false);
	});

	it('a free user who selects Chapter range or Save preset gets the Pro notice with a Sponsor button, and nothing changes or saves', async () => {
		expect(await setPro(false)).toBe(false);
		await openWindow();
		const before = await state();
		const range = await browser.$('.chapter-batch-export-modal input[data-field="range"]');
		expect(await range.isEnabled()).toBe(true);
		await range.click();
		await browser.keys(['1']);
		await browser.pause(300);
		const afterRange = await state();
		if (!afterRange.notices.some((n) => n.text.includes(LEAD) && n.sponsor === 1)) throw new Error(`No Pro notice after the Chapter range click: ${JSON.stringify(afterRange.notices)}`);
		expect(afterRange.range).toBe(before.range);
		await browser.executeObsidian(() => { activeDocument.querySelectorAll('.notice').forEach((n) => n.remove()); });
		const save = await browser.$('//div[contains(@class,"chapter-batch-export-modal")]//button[normalize-space(text())="Save preset"]');
		expect(await save.isEnabled()).toBe(true);
		await save.click();
		await browser.pause(300);
		const after = await state();
		if (!after.notices.some((n) => n.text.includes(LEAD) && n.sponsor === 1)) throw new Error(`No Pro notice after Save preset: ${JSON.stringify(after.notices)}`);
		expect(after.presets).toBe(0);
		expect(after.saved).toBe(before.saved);
		expect(after.options).toBe(before.options);
		expect(after.status).toBe('ready');
		expect(after.exportDisabled).toBe(false);
	});

	it('a Pro user who types a chapter range changes the option, with no Pro notice', async () => {
		expect(await setPro(true)).toBe(true);
		await openWindow();
		const range = await browser.$('.chapter-batch-export-modal input[data-field="range"]');
		await range.click();
		await browser.keys(['2']);
		await browser.pause(300);
		const after = await state();
		expect(after.range).toBe('2');
		expect(after.options).toContain('"range":"2"');
		expect(after.notices.filter((n) => n.sponsor > 0)).toEqual([]);
	});
});
