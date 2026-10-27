import { browser, expect } from '@wdio/globals';
import type { SponsorsManager } from '../../src/license/index';
import { pluginId } from './load';

// A free user who runs a Pro command gets the shared Pro notice with the "Sponsor on GitHub" button, and nothing runs.
// A Pro user who runs Save a named baseline saves it.
type Plugin = { pro: SponsorsManager; state: { named: { name: string; path: string }[] }; loadData(): Promise<unknown>; saveData(d: unknown): Promise<void> };
type Host = { plugins: { plugins: Record<string, Plugin> } };
const NOTE = 'Pro notice draft.md';

async function setPro(on: boolean): Promise<boolean> {
	return browser.executeObsidian(async ({ app }, enabled, id) => {
		const pro = (app as unknown as Host).plugins.plugins[id]!.pro;
		if (!enabled) { pro.signOut(); return pro.isPro(); }
		// Synthetic token store and HTTP answer. No network request or Keychain key.
		let token: string | null = 'gho_' + '0'.repeat(36);
		pro.opts.tokens.get = () => token; pro.opts.tokens.set = (v) => { token = v; }; pro.opts.tokens.clear = () => { token = null; };
		pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader', totalSponsorshipAmountAsSponsorInCents: 1500 }, user: { viewerIsSponsoring: true, sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
		await pro.refreshNow();
		return pro.isPro();
	}, on, pluginId);
}

/** Opens the draft note in an editor, runs the command, then reads the notices and the named baselines. */
async function run(command: string) {
	await browser.executeObsidian(async ({ app }, note) => {
		activeDocument.querySelectorAll('.notice').forEach((n) => n.remove());
		const f = app.vault.getFileByPath(note) ?? await app.vault.create(note, 'We meet at noon.\n');
		await app.workspace.getLeaf(false).openFile(f);
	}, NOTE);
	await browser.pause(300);
	await browser.executeObsidianCommand(`${pluginId}:${command}`);
	await browser.pause(500);
	return browser.executeObsidian(async ({ app }, id) => {
		const p = (app as unknown as Host).plugins.plugins[id]!;
		return {
			notices: [...activeDocument.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', sponsor: n.querySelectorAll('.pf-pro-notice-sponsor').length })),
			named: p.state.named.map((b) => b.path),
			saved: JSON.stringify((await p.loadData()) ?? {}),
		};
	}, pluginId);
}

describe('Pro commands', function () {
	let original: unknown = null;
	before(async () => {
		original = await browser.executeObsidian(async ({ app }, id) => (app as unknown as Host).plugins.plugins[id]!.loadData(), pluginId);
	});
	afterEach(async () => {
		await setPro(false);
		await browser.executeObsidian(async ({ app }, id, original) => {
			const p = (app as unknown as Host).plugins.plugins[id]!;
			p.state.named = p.state.named.filter((b) => b.path !== 'Pro notice draft.md');
			await p.saveData(original ?? p.state);
		}, pluginId, original);
	});

	it('a free user who runs Save a named baseline, Create a named baseline review or Create folder reviews gets a Pro notice with a Sponsor button, and nothing runs', async () => {
		expect(await setPro(false)).toBe(false);
		for (const [command, lead] of [['save-named-baseline', 'A named baseline needs Pro.'], ['review-named-baseline', 'A named baseline needs Pro.'], ['review-folder', 'A folder review needs Pro.']]) {
			const before = await browser.executeObsidian(async ({ app }, id) => JSON.stringify((await (app as unknown as Host).plugins.plugins[id]!.loadData()) ?? {}), pluginId);
			const after = await run(command!);
			if (!after.notices.some((n) => n.text.includes(lead!) && n.sponsor === 1)) throw new Error(`No Pro notice after ${command}: ${JSON.stringify(after.notices)}`);
			expect(after.named).not.toContain(NOTE);
			expect(after.saved).toBe(before);
		}
	});

	it('a Pro user who runs Save a named baseline saves it, with no Sponsor notice', async () => {
		expect(await setPro(true)).toBe(true);
		const after = await run('save-named-baseline');
		expect(after.named).toContain(NOTE);
		expect(after.notices.filter((n) => n.sponsor > 0)).toEqual([]);
	});
});
