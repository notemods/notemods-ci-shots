import { browser, expect } from '@wdio/globals';
import { pluginId } from './load';
import { ACTIVE, LAST, NOTE, TARGET, activePath, openNote, setCursor, setMode, writeNote } from './helpers';
import type Plugin from '../../src/main';

const MATH_ROW = 'Math in aliases';
const LEAD = 'Math in aliases is a Pro feature.';
const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';

type P = { plugins: { plugins: Record<string, Plugin> } };

async function notices(): Promise<Array<{ text: string; buttons: number }>> {
	return browser.execute(() => [...(window as unknown as { activeWindow: Window }).activeWindow.document.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', buttons: n.querySelectorAll('.pf-pro-notice-sponsor').length })));
}

async function mathRow(): Promise<boolean | null> {
	return browser.execute((label: string) => {
		const root = (window as unknown as { app: { setting: { activeTab?: { containerEl: HTMLElement } } } }).app.setting.activeTab?.containerEl ?? document.body;
		const item = [...root.querySelectorAll('.setting-item')].find((el) => el.querySelector('.setting-item-name')?.textContent?.trim() === label);
		const toggle = item?.querySelector('.checkbox-container');
		return toggle ? toggle.classList.contains('is-enabled') : null;
	}, MATH_ROW);
}

async function setPro(on: boolean): Promise<void> {
	await browser.executeObsidian(
		async ({ app }, id, value) => {
			const p = (app as unknown as P).plugins.plugins[id]!;
			const pro = p.pro as unknown as { opts: { http: unknown }; refreshNow(): Promise<void>; signOut(): void };
			if (!value) {
				pro.signOut();
				return;
			}
			const reply = { status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } };
			pro.opts.http = () => Promise.resolve(reply);
			app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
			await pro.refreshNow();
		},
		pluginId,
		on,
	);
}

describe('Pro: math in aliases', function () {
	before(async function () {
		await writeNote('Target.md', TARGET);
		await writeNote('Alias.md', NOTE);
		await setPro(false);
	});

	it('A12 free: the math setting gives the Pro notice with a Sponsor button and stays off', async function () {
		await browser.executeObsidian(({ app }, id) => {
			for (const doc of new Set([document, (window as unknown as { activeWindow: Window }).activeWindow.document])) doc.querySelectorAll('.notice').forEach((n) => n.remove());
			const setting = (app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting;
			setting.open();
			setting.openTabById(id);
		}, pluginId);
		await browser.waitUntil(async () => (await mathRow()) !== null, { timeout: 5000, timeoutMsg: 'no math row' });
		expect(await mathRow()).toBe(false);
		await browser.execute((label: string) => {
			const root = (window as unknown as { app: { setting: { activeTab?: { containerEl: HTMLElement } } } }).app.setting.activeTab?.containerEl ?? document.body;
			const item = [...root.querySelectorAll('.setting-item')].find((el) => el.querySelector('.setting-item-name')?.textContent?.trim() === label)!;
			const box = item.querySelector<HTMLElement>('.checkbox-container')!;
			box.focus();
			box.click();
		}, MATH_ROW);
		await browser.waitUntil(async () => (await notices()).some((n) => n.text.includes(LEAD)), { timeout: 5000, timeoutMsg: 'no Pro notice' });
		const notice = (await notices()).find((n) => n.text.includes(LEAD))!;
		expect(notice.text).toContain(`${LEAD} ${PITCH}`);
		expect(notice.buttons).toBe(1);
		await browser.waitUntil(async () => (await mathRow()) === false, { timeout: 5000, timeoutMsg: 'the toggle does not show off again' });
		await browser.executeObsidian(({ app }) => (app as unknown as { setting: { close(): void } }).setting.close());
	});

	it('A12 free: math in an alias stays text in both views', async function () {
		await openNote();
		const live = await browser.execute((sel: string) => document.querySelectorAll(`${sel} .markdown-source-view .wam-math`).length, ACTIVE);
		expect(live).toBe(0);
		await setMode('preview');
		const read = async (): Promise<string> => browser.execute((sel: string) => Array.from(document.querySelectorAll(`${sel} .markdown-reading-view a.internal-link`)).find((a) => (a.textContent ?? '').includes('gas'))?.innerHTML ?? '', ACTIVE);
		await browser.waitUntil(async () => (await read()) !== '', { timeout: 10000, timeoutMsg: 'no math link in Reading view' });
		// The other links of the note have their markup, so the post processor ran on this section.
		await browser.waitUntil(async () => (await browser.execute((sel: string) => document.querySelectorAll(`${sel} .markdown-reading-view .wam-alias`).length, ACTIVE)) >= 4, { timeout: 10000, timeoutMsg: 'no markup in Reading view' });
		expect(await read()).toBe('$NH_3$ gas');
	});

	it('A12 Pro: math in an alias shows MathJax in Reading view and Live Preview; a click opens the target', async function () {
		await setPro(true);
		try {
			const sel = `${ACTIVE} .markdown-reading-view`;
			await browser.waitUntil(async () => (await browser.execute((s: string) => !!document.querySelector(`${s} a.internal-link mjx-container`), sel)) === true, { timeout: 15000, timeoutMsg: 'no MathJax in the Reading view link' });
			const reading = await browser.execute((s: string) => {
				const a = document.querySelector(`${s} a.internal-link mjx-container`)!.closest('a')!;
				return { href: a.getAttribute('data-href'), text: (a.lastChild?.textContent ?? '').trim() };
			}, sel);
			expect(reading).toEqual({ href: 'Target', text: 'gas' });
			await setMode('source');
			await setCursor(LAST, 0);
			await browser.waitUntil(async () => (await browser.execute((s: string) => !!document.querySelector(`${s} .markdown-source-view .wam-math mjx-container`), ACTIVE)) === true, { timeout: 15000, timeoutMsg: 'no MathJax in Live Preview' });
			await browser.$(`${ACTIVE} .markdown-source-view .wam-math`).click();
			await browser.waitUntil(async () => (await activePath()) === 'Target.md', { timeout: 5000, timeoutMsg: 'Target.md did not open from the math widget' });
		} finally {
			await setPro(false);
		}
	});
});
