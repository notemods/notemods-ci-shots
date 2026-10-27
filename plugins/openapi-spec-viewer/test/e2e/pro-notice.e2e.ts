import { browser, expect } from '@wdio/globals';
import type LocalApiPlugin from '../../src/main';
import type { ReferenceView } from '../../src/view';
import { pluginId } from './load';

// A free user selects "Write endpoint note (Pro)" and "Bookmark endpoint (Pro)" in the endpoint detail: the shared
// Pro notice shows with the "Sponsor on GitHub" button, no note is written and no bookmark is saved. A Pro user's
// clicks write the note and save the bookmark.
const PATH = 'pro-notice-test.json';
const NOTE = 'Write endpoint note (Pro)';
const MARK = 'Bookmark endpoint (Pro)';
const source = JSON.stringify({ openapi: '3.1.0', info: { title: 'Notice service' }, paths: { '/owners': { get: { tags: ['Owners'], summary: 'List owners', responses: { '200': { description: 'OK' } } } } } });
type P = LocalApiPlugin & { pro: { opts: { http: unknown }; refreshNow(): Promise<unknown>; signOut(): void; isPro(): boolean } };

async function setPro(on: boolean): Promise<boolean> {
	return browser.executeObsidian(async ({ app }, id, on) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, P> } }).plugins.plugins[id]!;
		if (!on) { p.pro.signOut(); return p.pro.isPro(); }
		p.pro.opts.http = () => Promise.resolve({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
		app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
		await p.pro.refreshNow();
		return p.pro.isPro();
	}, pluginId, on);
}

async function open(): Promise<void> {
	await browser.executeObsidian(async ({ app }, id, path, source) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, P> } }).plugins.plugins[id]!;
		document.querySelectorAll('.notice').forEach((n) => n.remove());
		for (const f of app.vault.getMarkdownFiles()) if (f.path.startsWith('API GET owners')) await app.fileManager.trashFile(f);
		p.settings = { bookmarks: [], filters: [] }; await p.saveData(p.settings);
		if (!app.vault.getFileByPath(path)) await app.vault.create(path, source);
		await p.openFile(path);
	}, pluginId, PATH, source);
	await browser.waitUntil(async () => (await state()).buttons.includes(NOTE), { timeout: 5000, timeoutMsg: 'The endpoint detail shows no Write endpoint note button.' });
}

async function state(): Promise<{ buttons: string[]; notes: string[]; data: string; notices: { text: string; buttons: number }[] }> {
	return browser.executeObsidian(async ({ app }, id, path) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, P> } }).plugins.plugins[id]!;
		const v = app.workspace.getLeavesOfType('local-api-reference').map((l) => l.view as ReferenceView).find((x) => x.path === path);
		return {
			buttons: v ? [...v.contentEl.querySelectorAll('.lar-detail button')].map((b) => b.textContent ?? '') : [],
			notes: app.vault.getMarkdownFiles().map((f) => f.path).filter((x) => x.startsWith('API GET owners')),
			data: JSON.stringify(await p.loadData()),
			notices: [...document.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', buttons: n.querySelectorAll('.pf-pro-notice-sponsor').length })),
		};
	}, pluginId, PATH);
}

async function click(label: string): Promise<void> {
	await browser.executeObsidian(({ app }, path, label) => {
		const v = app.workspace.getLeavesOfType('local-api-reference').map((l) => l.view as ReferenceView).find((x) => x.path === path)!;
		[...v.contentEl.querySelectorAll<HTMLButtonElement>('.lar-detail button')].find((b) => b.textContent === label)!.click();
	}, PATH, label);
}

describe('Endpoint note and bookmark buttons for a free user and a Pro user', function () {
	afterEach(async function () { await setPro(false); });

	it('a free user who selects Write endpoint note or Bookmark endpoint gets the Pro notice with a Sponsor button, and nothing is saved', async function () {
		expect(await setPro(false)).toBe(false);
		await open();
		const before = await state();
		await click(NOTE);
		await browser.waitUntil(async () => (await state()).notices.some((n) => n.text.includes('Endpoint notes need Pro.')), { timeout: 5000, timeoutMsg: 'No Pro notice after Write endpoint note.' });
		await click(MARK);
		await browser.waitUntil(async () => (await state()).notices.some((n) => n.text.includes('Endpoint bookmarks need Pro.')), { timeout: 5000, timeoutMsg: 'No Pro notice after Bookmark endpoint.' });
		await browser.pause(500);
		const after = await state();
		for (const lead of ['Endpoint notes need Pro.', 'Endpoint bookmarks need Pro.']) expect(after.notices.find((n) => n.text.includes(lead))!.buttons).toBe(1);
		expect(after.notes).toEqual([]);
		expect(after.data).toBe(before.data);
		expect(after.buttons).toContain(MARK);
	});

	it('a Pro user who selects Write endpoint note and Bookmark endpoint writes the note and saves the bookmark', async function () {
		expect(await setPro(true)).toBe(true);
		await open();
		await click(NOTE);
		await browser.waitUntil(async () => (await state()).notes.length === 1, { timeout: 10000, timeoutMsg: 'The Pro user got no endpoint note.' });
		await click(MARK);
		await browser.waitUntil(async () => (await state()).buttons.includes('Remove bookmark (Pro)'), { timeout: 10000, timeoutMsg: 'The Pro user got no bookmark.' });
		const after = await state();
		expect((JSON.parse(after.data) as { bookmarks: unknown[] }).bookmarks).toHaveLength(1);
		expect(after.notices.some((n) => n.buttons > 0)).toBe(false);
	});
});
