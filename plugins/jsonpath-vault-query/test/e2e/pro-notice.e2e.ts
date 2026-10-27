import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import type QueryPlugin from '../../src/main';
import type { SponsorsManager } from '../../src/license/index';

// A free user who selects "Run saved query on files" or "Write report" gets the shared Pro notice with the
// "Sponsor on GitHub" button. No file is read or written, and the shown result stays. A Pro user runs the batch.
type Host = { plugins: { plugins: Record<string, QueryPlugin> } };
const BATCH = 'A saved query on several files needs Pro.';
const REPORT = 'New report files need Pro.';

async function setPro(on: boolean): Promise<boolean> {
	return browser.executeObsidian(async ({ app }, enabled) => {
		const p = (app as unknown as Host).plugins.plugins['jsonpath-vault-query']!;
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

async function openView(): Promise<void> {
	await obsidianPage.write('Pro check/a.json', '[1, 2]');
	await obsidianPage.write('Pro check/b.json', '[3]');
	await browser.executeObsidian(async ({ app }) => {
		const p = (app as unknown as Host).plugins.plugins['jsonpath-vault-query']!;
		await p.saveQuery({ name: 'Pro check all', path: 'Pro check/a.json', expression: '@' });
		const v = await p.openView();
		Object.assign(v, { path: 'Pro check/a.json', expression: '@', savedName: 'Pro check all', batchPaths: 'Pro check/a.json\nPro check/b.json' });
		v.draw();
		await v.run();
		activeDocument.querySelectorAll('.notice').forEach((n) => n.remove());
	});
}

async function press(label: string) {
	const button = await browser.$(`//div[contains(@class,"local-json-query")]//button[normalize-space(text())="${label}"]`);
	await button.click();
	await browser.pause(500);
	return browser.executeObsidian(async ({ app }) => {
		const leaf = app.workspace.getLeavesOfType('jsonpath-vault-query-view')[0]!;
		const v = leaf.view as unknown as { result: unknown };
		return {
			notices: [...activeDocument.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', sponsor: n.querySelectorAll('.pf-pro-notice-sponsor').length })),
			result: JSON.stringify(v.result ?? null),
			modal: activeDocument.querySelectorAll('.modal').length,
			report: !!app.vault.getAbstractFileByPath('Query report.csv'),
		};
	});
}

describe('Pro buttons of the query view', function () {
	afterEach(async () => {
		await browser.executeObsidian(async ({ app }) => {
			activeDocument.querySelectorAll<HTMLElement>('.modal-close-button').forEach((b) => b.click());
			const p = (app as unknown as Host).plugins.plugins['jsonpath-vault-query']!;
			await p.deleteQuery('Pro check all');
		});
		await setPro(false);
	});

	it('a free user who selects Run saved query on files or Write report gets the Pro notice with a Sponsor button, and nothing is read or written', async () => {
		expect(await setPro(false)).toBe(false);
		await openView();
		const batch = await press('Run saved query on files');
		if (!batch.notices.some((n) => n.text.includes(BATCH) && n.sponsor === 1)) throw new Error(`No Pro notice after the batch run: ${JSON.stringify(batch.notices)}`);
		expect(batch.result).toBe('[1,2]');
		const report = await press('Write report');
		if (!report.notices.some((n) => n.text.includes(REPORT) && n.sponsor === 1)) throw new Error(`No Pro notice after Write report: ${JSON.stringify(report.notices)}`);
		expect(report.modal).toBe(0);
		expect(report.report).toBe(false);
		expect(report.result).toBe('[1,2]');
	});

	it('a Pro user who selects Run saved query on files gets the combined result, with no Pro notice', async () => {
		expect(await setPro(true)).toBe(true);
		await openView();
		const batch = await press('Run saved query on files');
		expect(batch.result).toBe('[1,2,3]');
		expect(batch.notices.filter((n) => n.sponsor > 0)).toEqual([]);
	});
});
