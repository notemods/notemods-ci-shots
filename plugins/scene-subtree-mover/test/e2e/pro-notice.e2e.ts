import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import type SceneSubtreeMoverPlugin from '../../src/main';
import type { SponsorsManager } from '../../src/license/index';
import { pluginId } from './load';

// A free user can select Add move (Pro) and Save named order (Pro). The select shows the shared Pro notice with the
// "Sponsor on GitHub" button. The preview and the saved orders do not change. A Pro user adds a second move.
type Host = { plugins: { plugins: Record<string, SceneSubtreeMoverPlugin> } };
const MOVES = 'More than one move in a preview needs Pro.';
const ORDERS = 'Named manuscript orders need Pro.';
const initial = '---\ntitle: Test manuscript\nlongform:\n  format: scenes\n  sceneFolder: Scenes\n  scenes:\n    - A\n    - - a1\n    - B\n    - C\n---\n\n# Manuscript\n';
const root = '.scene-subtree-mover-modal';
const path = 'Pro notice.md';

async function setPro(on: boolean): Promise<boolean> {
	return browser.executeObsidian(async ({ app }, enabled) => {
		const p = (app as unknown as Host).plugins.plugins['scene-subtree-mover']!;
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

async function openAndStage(): Promise<void> {
	await obsidianPage.write(path, initial);
	await obsidianPage.openFile(path);
	await browser.waitUntil(async () => browser.executeObsidian(({ app }, p) => app.workspace.getActiveFile()?.path === p, path), { timeout: 15000, timeoutMsg: 'Index did not become active' });
	await browser.executeObsidianCommand(`${pluginId}:move-chapter`);
	await browser.$(`${root} [data-field="chapter"]`).waitForExist();
	await browser.$(`${root} [data-field="position"]`).selectByAttribute('value', '2');
	await browser.$(`${root} [data-action="preview"]`).click();
	await browser.waitUntil(async () => (await browser.$(`${root} .ssm-status`).getText()).includes('1 move in the preview'), { timeout: 15000, timeoutMsg: 'First move not staged' });
	await browser.executeObsidian(() => { activeDocument.querySelectorAll('.notice').forEach((n) => n.remove()); });
}

async function state() {
	return browser.executeObsidian(async ({ app }) => {
		const p = (app as unknown as Host).plugins.plugins['scene-subtree-mover']!;
		const modal = activeDocument.querySelector('.scene-subtree-mover-modal')!;
		return {
			notices: [...activeDocument.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', sponsor: n.querySelectorAll('.pf-pro-notice-sponsor').length })),
			after: modal.querySelector('[data-tree="after"]')?.textContent ?? '',
			status: modal.querySelector('.ssm-status')?.textContent ?? '',
			orders: p.settings.orders.length,
			saved: JSON.stringify((await p.loadData()) ?? {}),
		};
	});
}

describe('Pro controls of the mover window', function () {
	afterEach(async () => {
		if (await browser.$(root).isExisting()) await browser.keys('Escape');
		await browser.waitUntil(async () => !(await browser.$(root).isExisting()), { timeout: 15000 });
		await setPro(false);
	});

	it('a free user who selects Add move or Save named order gets the Pro notice with a Sponsor button, and nothing changes', async () => {
		expect(await setPro(false)).toBe(false);
		await openAndStage();
		const before = await state();
		const add = await browser.$(`${root} [data-action="preview"]`);
		expect(await add.isEnabled()).toBe(true);
		await add.click();
		await browser.pause(300);
		const afterAdd = await state();
		if (!afterAdd.notices.some((n) => n.text.includes(MOVES) && n.sponsor === 1)) throw new Error(`No Pro notice after Add move: ${JSON.stringify(afterAdd.notices)}`);
		expect(afterAdd.after).toBe(before.after);
		expect(afterAdd.status).toBe(before.status);
		await browser.execute((r: string) => { document.querySelector<HTMLDetailsElement>(`${r} details.ssm-pro`)!.open = true; }, root);
		await browser.$(`${root} [data-action="save"]`).click();
		await browser.pause(300);
		const afterSave = await state();
		if (!afterSave.notices.some((n) => n.text.includes(ORDERS) && n.sponsor === 1)) throw new Error(`No Pro notice after Save named order: ${JSON.stringify(afterSave.notices)}`);
		expect(afterSave.orders).toBe(before.orders);
		expect(afterSave.saved).toBe(before.saved);
		expect(afterSave.after).toBe(before.after);
	});

	it('a Pro user who selects Add move adds a second move, with no Pro notice', async () => {
		expect(await setPro(true)).toBe(true);
		await openAndStage();
		await browser.$(`${root} [data-field="position"]`).selectByAttribute('value', '1');
		await browser.$(`${root} [data-action="preview"]`).click();
		await browser.waitUntil(async () => (await browser.$(`${root} .ssm-status`).getText()).includes('2 moves'), { timeout: 15000, timeoutMsg: 'Second move not staged' });
		expect((await state()).notices.filter((n) => n.sponsor > 0)).toEqual([]);
	});
});
