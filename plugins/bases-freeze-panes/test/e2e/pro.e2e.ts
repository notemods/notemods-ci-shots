import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { lastNotice, pluginId } from './load';

// Pro through GitHub Sponsors with a stubbed network: the plugin's http client is replaced inside Obsidian,
// so no request reaches github.com. The token goes through the real app.secretStorage.
const DIR = 'Bases Freeze Panes';
const TOKEN_ID = `${pluginId}-github-token`;
const FAKE_TOKEN = `gho_${'0'.repeat(36)}`;

interface ProbeRow {
	frozen: number;
	end: number;
}

/** Scrolls the table in the active tab far right and counts frozen and end-pinned cells in the first body row. */
async function frozenCells(): Promise<ProbeRow | null> {
	return browser.executeAsync((done: (r: ProbeRow | null) => void) => {
		const v = Array.from(document.querySelectorAll<HTMLElement>('.workspace-leaf.mod-active .bases-view')).find((x) => x.offsetParent !== null);
		if (!v) return done(null);
		v.scrollLeft = 0;
		setTimeout(() => {
			v.scrollLeft = 500;
			setTimeout(() => {
				const row = v.querySelector('.bases-tbody > .bases-tr');
				done(row ? { frozen: row.querySelectorAll('.bfp-frozen').length, end: row.querySelectorAll('.bfp-end').length } : null);
			}, 700);
		}, 300);
	});
}

/** Puts a fake GitHub reply into the plugin, stores a fake token in SecretStorage and presses Refresh. */
async function signInWith(reply: { status: number; json: unknown }): Promise<{ pro: boolean; status: string; secret: string | null }> {
	return browser.executeObsidian(
		async ({ app }, id, tokenId, token, r) => {
			interface Pro {
				opts: { http: unknown };
				refreshNow(): Promise<void>;
				getState(): { status: string };
			}
			const p = (app as unknown as { plugins: { plugins: Record<string, { pro: Pro; isPro(): boolean }> } }).plugins.plugins[id]!;
			p.pro.opts.http = () => Promise.resolve(r);
			app.secretStorage.setSecret(tokenId, token);
			await p.pro.refreshNow();
			return { pro: p.isPro(), status: p.pro.getState().status, secret: app.secretStorage.getSecret(tokenId) };
		},
		pluginId,
		TOKEN_ID,
		FAKE_TOKEN,
		reply,
	);
}

async function setSettings(values: Record<string, unknown>): Promise<void> {
	await browser.executeObsidian(
		({ app }, id, v) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, { settings: Record<string, unknown>; refresh(): void }> } }).plugins.plugins[id]!;
			Object.assign(p.settings, v);
			p.refresh();
		},
		pluginId,
		values,
	);
}

const sponsoring = (cents: number, oneTime = false) => ({
	status: 200,
	json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: oneTime, tier: { name: 'tier', monthlyPriceInCents: cents, isOneTime: oneTime } } } } },
});

describe(`${pluginId} pro (GitHub Sponsors, stubbed network)`, function () {
	before(async function () {
		await obsidianPage.openFile(`${DIR}/Reading log.base`);
		await browser.waitUntil(async () => (await frozenCells()) !== null, { timeout: 15000, timeoutMsg: 'no Bases table' });
	});

	it('starts signed out and has made no request', async function () {
		const state = await browser.executeObsidian(({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, { pro: { getState(): { status: string; lastAttemptAt: number } }; isPro(): boolean }> } }).plugins.plugins[id]!;
			return { ...p.pro.getState(), pro: p.isPro() };
		}, pluginId);
		expect(state).toMatchObject({ status: 'signed-out', lastAttemptAt: 0, pro: false });
	});

	it('without Pro: 3 columns and the last column are locked, the free first column still works', async function () {
		await setSettings({ columns: 3, freezeLast: true });
		expect(await frozenCells()).toEqual({ frozen: 1, end: 0 });
	});

	it('without Pro: the per-file column command shows the Pro notice and opens nothing', async function () {
		await browser.executeObsidian(({ app }, id) => (app as unknown as { commands: { executeCommandById(c: string): boolean } }).commands.executeCommandById(`${id}:set-file-columns`), pluginId);
		await browser.pause(300);
		expect(await lastNotice()).toContain('pro feature');
		expect(await browser.execute(() => document.querySelectorAll('.prompt').length)).toBe(0);
	});

	it('a $3 monthly sponsor is below the tier: still locked', async function () {
		const r = await signInWith(sponsoring(300));
		expect(r).toMatchObject({ pro: false, status: 'no' });
		expect(await frozenCells()).toEqual({ frozen: 1, end: 0 });
	});

	it('a $5 monthly sponsor gets Pro: 3 frozen columns and the pinned last column', async function () {
		const r = await signInWith(sponsoring(500));
		expect(r).toEqual({ pro: true, status: 'pro', secret: FAKE_TOKEN });
		expect(await frozenCells()).toEqual({ frozen: 3, end: 1 });
	});

	it('a $15 one-time sponsor gets Pro', async function () {
		expect((await signInWith(sponsoring(1500, true))).pro).toBe(true);
	});

	it('401 from GitHub signs out, empties the secret and locks Pro again; free columns keep working', async function () {
		const r = await signInWith({ status: 401, json: { message: 'Bad credentials' } });
		expect(r.pro).toBe(false);
		expect(r.status).toBe('signed-out');
		expect(r.secret === null || r.secret === '').toBe(true);
		expect(await frozenCells()).toEqual({ frozen: 1, end: 0 });
	});

	it('Sign out empties the secret in SecretStorage', async function () {
		await signInWith(sponsoring(500));
		const secret = await browser.executeObsidian(({ app }, id, tokenId) => {
			(app as unknown as { plugins: { plugins: Record<string, { pro: { signOut(): void } }> } }).plugins.plugins[id]!.pro.signOut();
			return app.secretStorage.getSecret(tokenId);
		}, pluginId, TOKEN_ID);
		expect(secret === null || secret === '').toBe(true);
		await setSettings({ columns: 1, freezeLast: false });
	});
});
