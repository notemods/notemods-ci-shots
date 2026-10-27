import { browser, expect } from '@wdio/globals';
import type PocketMarkwhenPlugin from '../../src/main';
import type { PocketMarkwhenView } from '../../src/view';

// A free user opens the Pro section of the timeline and selects "Combine files (Pro)" and "Export Markdown list (Pro)":
// the shared Pro notice shows with the "Sponsor on GitHub" button, no file is written and no setting is saved.
// A Pro user's export writes the Markdown list.
const id = 'pocket-markwhen';
const source = '2026-03-01: Fly out\n2026-03-02 / 2026-03-05: Rome #italy';
const COMBINE = 'Combine files (Pro)';
const EXPORT = 'Export Markdown list (Pro)';
type P = PocketMarkwhenPlugin & { pro: { opts: { http: unknown }; refreshNow(): Promise<unknown>; signOut(): void; isPro(): boolean } };

async function setPro(on: boolean): Promise<boolean> {
	return browser.executeObsidian(async ({ app }, id, on) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, P> } }).plugins.plugins[id]!;
		if (!on) { p.pro.signOut(); return p.pro.isPro(); }
		p.pro.opts.http = () => Promise.resolve({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
		app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
		await p.pro.refreshNow();
		return p.pro.isPro();
	}, id, on);
}

async function open(): Promise<void> {
	await browser.executeObsidian(async ({ app }, id, text) => {
		document.querySelectorAll('.notice').forEach((n) => n.remove());
		for (const f of app.vault.getMarkdownFiles()) if (f.path.startsWith('Markwhen events')) await app.fileManager.trashFile(f);
		await app.workspace.getMostRecentLeaf()!.setViewState({ type: 'empty', active: true });
		const file = app.vault.getFileByPath('notice-trip.mw');
		if (file) await app.vault.modify(file, text); else await app.vault.create('notice-trip.mw', text);
		const p = (app as unknown as { plugins: { plugins: Record<string, P> } }).plugins.plugins[id]!;
		await p.openTimeline(app.vault.getFileByPath('notice-trip.mw')!);
	}, id, source);
	await browser.waitUntil(async () => browser.executeObsidian(({ app }, expected) => { const view = app.workspace.getMostRecentLeaf()!.view as PocketMarkwhenView; return view.getViewType() === 'pocket-markwhen-timeline' && view.getViewData() === expected; }, source), { timeout: 10000 });
	await browser.executeObsidian(({ app }) => (app.workspace.getMostRecentLeaf()!.view as PocketMarkwhenView).showTab(false));
}

async function click(label: string): Promise<boolean> {
	return browser.executeObsidian(({ app }, label) => {
		const el = app.workspace.getMostRecentLeaf()!.view.containerEl;
		const details = el.querySelector<HTMLDetailsElement>('.pocket-markwhen-pro details');
		if (details) details.open = true;
		const button = [...el.querySelectorAll<HTMLButtonElement>('.pocket-markwhen-pro button')].find((b) => b.textContent === label);
		if (!button || button.disabled || !button.isShown()) return false;
		button.click(); return true;
	}, label);
}

async function state(): Promise<{ exports: string[]; data: string; notices: { text: string; buttons: number }[] }> {
	return browser.executeObsidian(async ({ app }, id) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, P> } }).plugins.plugins[id]!;
		return {
			exports: app.vault.getMarkdownFiles().map((f) => f.path).filter((x) => x.startsWith('Markwhen events')),
			data: JSON.stringify(await p.loadData()),
			notices: [...document.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', buttons: n.querySelectorAll('.pf-pro-notice-sponsor').length })),
		};
	}, id);
}

describe('Pro section of the timeline for a free user and a Pro user', function () {
	afterEach(async function () { await setPro(false); });

	it('a free user who selects Combine files or Export Markdown list gets the Pro notice with a Sponsor button, and nothing runs', async function () {
		expect(await setPro(false)).toBe(false);
		await open();
		const before = await state();
		expect(await click(COMBINE)).toBe(true);
		await browser.waitUntil(async () => (await state()).notices.some((n) => n.text.includes('Combined files need Pro.')), { timeout: 5000, timeoutMsg: 'No Pro notice after Combine files.' });
		expect(await click(EXPORT)).toBe(true);
		await browser.waitUntil(async () => (await state()).notices.some((n) => n.text.includes('The Markdown list export needs Pro.')), { timeout: 5000, timeoutMsg: 'No Pro notice after Export Markdown list.' });
		await browser.pause(500);
		const after = await state();
		for (const lead of ['Combined files need Pro.', 'The Markdown list export needs Pro.']) expect(after.notices.find((n) => n.text.includes(lead))!.buttons).toBe(1);
		expect(after.exports).toEqual([]);
		expect(after.data).toBe(before.data);
	});

	it('a Pro user who selects Export Markdown list writes the list', async function () {
		expect(await setPro(true)).toBe(true);
		await open();
		expect(await click(EXPORT)).toBe(true);
		await browser.waitUntil(async () => (await state()).exports.length === 1, { timeout: 10000, timeoutMsg: 'The Pro user got no Markdown list.' });
		expect((await state()).notices.some((n) => n.buttons > 0)).toBe(false);
	});
});
