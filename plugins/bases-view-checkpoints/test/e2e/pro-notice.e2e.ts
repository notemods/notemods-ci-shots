import { browser, expect } from '@wdio/globals';
import type BasesViewCheckpointsPlugin from '../../src/main';
import { pluginId } from './load';

// A free user can run the two Pro commands. The command shows the shared Pro notice with the "Sponsor on GitHub"
// button, opens no picker and saves nothing. A Pro user (simulated GitHub Sponsors answer) gets the picker.
const LEADS = { named: 'Named checkpoints need Pro.', compare: 'Compare checkpoint with current view needs Pro.' };

async function setPro(on: boolean): Promise<boolean> {
	return browser.executeObsidian(async ({ app }, id, on) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, BasesViewCheckpointsPlugin> } }).plugins.plugins[id]!;
		if (!on) { p.pro!.signOut(); return p.pro!.isPro(); }
		(p.pro as unknown as { opts: { http: unknown } }).opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
		app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
		await p.pro!.refreshNow();
		return p.pro!.isPro();
	}, pluginId, on);
}

async function state(): Promise<{ notices: { text: string; buttons: number }[]; picker: boolean; named: number; saved: string }> {
	return browser.executeObsidian(async ({ app }, id) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, BasesViewCheckpointsPlugin> } }).plugins.plugins[id]!;
		const doc = activeWindow.document;
		const saved = JSON.stringify(((await p.loadData()) as { named?: unknown } | null)?.named ?? {});
		return {
			notices: [...doc.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', buttons: n.querySelectorAll('.pf-pro-notice-sponsor').length })),
			picker: !!doc.querySelector('.prompt-input'),
			named: Object.keys(p.data.named).length,
			saved,
		};
	}, pluginId);
}

async function clear(): Promise<void> {
	await browser.keys('Escape');
	await browser.execute(() => activeWindow.document.querySelectorAll('.notice').forEach((n) => n.remove()));
}

describe(`${pluginId} Pro commands`, function () {
	afterEach(async () => { await clear(); await setPro(false); });

	it('a free user who runs Save named checkpoint or Compare checkpoint gets a Pro notice with a Sponsor button, and nothing runs', async () => {
		expect(await setPro(false)).toBe(false);
		await clear();
		for (const [command, lead] of [['save-named', LEADS.named], ['compare-checkpoint', LEADS.compare]] as const) {
			await browser.executeObsidianCommand(`${pluginId}:${command}`);
			await browser.waitUntil(async () => (await state()).notices.some((n) => n.text.includes(lead)), { timeout: 5000, timeoutMsg: `No Pro notice after ${command}: ${JSON.stringify(await state())}` });
		}
		const s = await state();
		for (const lead of Object.values(LEADS)) expect(s.notices.find((n) => n.text.includes(lead))?.buttons).toBe(1);
		expect(s.picker).toBe(false);
		expect(s.named).toBe(0);
		expect(s.saved).toBe('{}');
	});

	it('a Pro user who runs Save named checkpoint gets the file picker and no Pro notice', async () => {
		expect(await setPro(true)).toBe(true);
		await clear();
		await browser.executeObsidianCommand(`${pluginId}:save-named`);
		await browser.waitUntil(async () => (await state()).picker, { timeout: 5000, timeoutMsg: 'The Pro user got no file picker.' });
		expect((await state()).notices.filter((n) => n.buttons > 0)).toHaveLength(0);
	});
});
