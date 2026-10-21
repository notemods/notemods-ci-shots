import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { lastNotice, pluginId } from './load';

// Pro through GitHub Sponsors with a stubbed network: the plugin's http client is replaced inside Obsidian,
// so no request reaches github.com. The token goes through the real app.secretStorage.
const DIR = 'AsciiDoc Files';
const TOKEN_ID = `${pluginId}-github-token`;
const FAKE_TOKEN = `gho_${'0'.repeat(36)}`;

interface Pro {
	opts: { http: unknown };
	refreshNow(): Promise<void>;
	getState(): { status: string; lastAttemptAt: number };
	signOut(): void;
}
type PluginShape = { pro: Pro; isPro(): boolean; rerenderAll(): void };

/** Puts a fake GitHub reply into the plugin, stores a fake token in SecretStorage and presses Refresh. */
async function signInWith(reply: { status: number; json: unknown }): Promise<{ pro: boolean; status: string; secret: string | null }> {
	return browser.executeObsidian(
		async ({ app }, id, tokenId, token, r) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, PluginShape> } }).plugins.plugins[id]!;
			p.pro.opts.http = () => Promise.resolve(r);
			app.secretStorage.setSecret(tokenId, token);
			await p.pro.refreshNow();
			await new Promise((res) => setTimeout(res, 800));
			return { pro: p.isPro(), status: p.pro.getState().status, secret: app.secretStorage.getSecret(tokenId) };
		},
		pluginId,
		TOKEN_ID,
		FAKE_TOKEN,
		reply,
	);
}

const sponsoring = (cents: number, oneTime = false) => ({
	status: 200,
	json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: oneTime, tier: { name: 'tier', monthlyPriceInCents: cents, isOneTime: oneTime } } } } },
});

async function preview(): Promise<{ headings: string[]; notes: number; code: string }> {
	return browser.execute(() => {
		const prev = document.querySelector('.workspace-leaf.mod-active .adoc-preview');
		return {
			headings: Array.from(prev?.querySelectorAll('h2') ?? []).map((h) => h.textContent ?? ''),
			notes: prev?.querySelectorAll('.adoc-include-note').length ?? 0,
			code: Array.from(prev?.querySelectorAll('pre code') ?? []).map((c) => c.textContent ?? '').join('\n'),
		};
	});
}

async function fileText(path: string): Promise<string | null> {
	return browser.executeObsidian(async ({ app }, p) => {
		const f = app.vault.getFileByPath(p);
		return f ? app.vault.read(f) : null;
	}, path);
}

async function panelText(): Promise<string> {
	return browser.execute(() => document.querySelector('.adoc-links')?.textContent ?? '');
}

describe(`${pluginId} pro (GitHub Sponsors, stubbed network)`, function () {
	before(async function () {
		await obsidianPage.openFile(`${DIR}/Handbook.adoc`);
		await browser.waitUntil(async () => (await preview()).headings.length > 0, { timeout: 15000, timeoutMsg: 'no preview' });
	});

	it('starts signed out and has made no request', async function () {
		const state = await browser.executeObsidian(({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, PluginShape> } }).plugins.plugins[id]!;
			return { ...p.pro.getState(), pro: p.isPro() };
		}, pluginId);
		expect(state).toMatchObject({ status: 'signed-out', lastAttemptAt: 0, pro: false });
	});

	it('without Pro: includes are notes, export and copy show the Pro notice and write nothing', async function () {
		expect((await preview()).notes).toBe(2);
		await browser.executeObsidianCommand(`${pluginId}:export-html`);
		await browser.pause(500);
		expect(await lastNotice()).toContain('pro feature');
		expect(await fileText(`${DIR}/Handbook.html`)).toBeNull();
	});

	it('without Pro: the links panel command shows the notice and opens no panel', async function () {
		await browser.executeObsidianCommand(`${pluginId}:open-links`);
		await browser.pause(300);
		expect(await lastNotice()).toContain('pro feature');
		expect(await browser.execute(() => document.querySelectorAll('.adoc-links').length)).toBe(0);
	});

	it('a $3 monthly sponsor is below the tier: still locked', async function () {
		const r = await signInWith(sponsoring(300));
		expect(r).toMatchObject({ pro: false, status: 'no' });
		expect((await preview()).notes).toBe(2);
	});

	it('a $5 monthly sponsor gets Pro: includes resolve with leveloffset, tags and lines', async function () {
		const r = await signInWith(sponsoring(500));
		expect(r).toEqual({ pro: true, status: 'pro', secret: FAKE_TOKEN });
		await browser.waitUntil(async () => (await preview()).headings.includes('Install the tools'), { timeout: 5000, timeoutMsg: 'includes not resolved' });
		const p = await preview();
		expect(p.notes).toBe(0);
		expect(p.headings).toEqual(expect.arrayContaining(['Release checklist', 'Install the tools', 'Configure a project', 'Deploy']));
		expect(p.code).toContain('tidewater publish --channel stable');
		expect(p.code).not.toContain('echo "done"');
		expect(p.code).toContain('target = "linux-x86_64"');
		expect(p.code).not.toContain('[notify]');
	});

	it('Pro: the links panel lists the outline, a missing xref and the note that links here', async function () {
		await browser.executeObsidianCommand(`${pluginId}:open-links`);
		await browser.waitUntil(async () => (await panelText()).includes('Linked from'), { timeout: 5000 });
		await browser.pause(600);
		const text = await panelText();
		expect(text).toContain('Install the tools');
		expect(text).toContain('Glossary.adoc');
		expect(text).toContain('missing');
		expect(text).toContain('Release notes.md');
		expect(text).toContain('Reference.adoc');
		expect(await browser.execute(() => document.querySelectorAll('.adoc-links .is-broken').length)).toBeGreaterThanOrEqual(1);
	});

	it('Pro: export writes Handbook.html next to the source with no script and no remote URL', async function () {
		await obsidianPage.openFile(`${DIR}/Handbook.adoc`);
		await browser.pause(500);
		await browser.executeObsidianCommand(`${pluginId}:export-html`);
		await browser.waitUntil(async () => (await fileText(`${DIR}/Handbook.html`)) !== null, { timeout: 5000 });
		const html = (await fileText(`${DIR}/Handbook.html`)) ?? '';
		expect(html).toMatch(/^<!DOCTYPE html>/);
		expect(html).toContain('<h1>Tidewater Release Handbook</h1>');
		expect(html).toContain('Install the tools');
		expect(html).toContain('href="Reference.html#exit-codes"');
		expect(html).not.toMatch(/<script/i);
		expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
	});

	it('a $15 one-time sponsor gets Pro', async function () {
		expect((await signInWith(sponsoring(1500, true))).pro).toBe(true);
	});

	it('401 from GitHub signs out, empties the secret and locks Pro again; the free preview keeps working', async function () {
		const r = await signInWith({ status: 401, json: { message: 'Bad credentials' } });
		expect(r.pro).toBe(false);
		expect(r.status).toBe('signed-out');
		expect(r.secret === null || r.secret === '').toBe(true);
		await browser.waitUntil(async () => (await preview()).notes === 2, { timeout: 5000 });
		expect((await preview()).headings).toContain('Release checklist');
		expect(await panelText()).toContain('part of pro');
	});
});
