import { browser, expect } from '@wdio/globals';
import { pluginId } from './load';

// A free user can select a Pro option in the settings tab. The plugin shows the shared Pro notice with a
// "Sponsor on GitHub" button and does not save the option. A Pro user selects the same option and it is saved.
const LEAD = 'Count folded lines is a Pro option.';
const NAME = 'Count folded lines';

interface Row {
	found: boolean;
	disabled: boolean;
	on: boolean;
	/** The texts in the tab, for the failure message. */
	names: string;
}

/**
 * Finds the toggle row of the setting with this name in the open settings tab, and selects the toggle when click is
 * true. The row is the nearest parent of the name that holds a checkbox.
 */
async function probe(name: string, click: boolean): Promise<Row> {
	return browser.executeObsidian(({ app }, n, c) => {
		const tab = (app as unknown as { setting: { activeTab?: { containerEl: HTMLElement } } }).setting.activeTab;
		const root = tab?.containerEl ?? document.body;
		const label = [...root.querySelectorAll<HTMLElement>('*')].find((el) => el.childElementCount === 0 && el.textContent?.trim() === n);
		let item: HTMLElement | null = label ?? null;
		while (item && item !== root && !item.querySelector('.checkbox-container, input[type="checkbox"]')) item = item.parentElement;
		const names = [...root.querySelectorAll<HTMLElement>('.setting-item-name')].map((el) => el.textContent?.trim() ?? '').join(' | ').slice(0, 600);
		if (!label || !item || item === root) return { found: false, disabled: false, on: false, names };
		const box = item.querySelector<HTMLElement>('.checkbox-container');
		const input = item.querySelector<HTMLInputElement>('input[type="checkbox"]');
		const disabled = item.classList.contains('is-disabled') || !!box?.classList.contains('is-disabled') || !!input?.disabled;
		const on = box ? box.classList.contains('is-enabled') : !!input?.checked;
		// A real click moves the focus into the row. Obsidian does not draw a focused control again, so the test focuses it too.
		if (c) { (box ?? input)?.focus(); (box ?? input)?.click(); }
		return { found: true, disabled, on, names };
	}, name, click);
}

const row = async (name: string): Promise<Omit<Row, 'names'>> => {
	const { names: _names, ...rest } = await probe(name, false);
	return rest;
};

async function clickToggle(name: string): Promise<void> {
	await probe(name, true);
}

/** Counts the notices that show the lead. Older notices stay; a test compares the count before and after a click. */
const withLead = async (): Promise<number> => (await notices()).filter((n) => n.text.includes(LEAD)).length;

/** What the page shows, for a failure message. */
const diagnose = (): Promise<string> => browser.executeObsidian((_o, lead) => {
	const hits = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => el.childElementCount === 0 && (el.textContent ?? '').includes(lead));
	const active = (window as unknown as { activeWindow?: Window }).activeWindow ?? window;
	return `same window: ${active === window}; active body has lead: ${active.document.body.innerText.includes(lead)}; active .notice: ${active.document.querySelectorAll('.notice').length}; body has lead: ${document.body.innerText.includes(lead)}; .notice-container: ${document.querySelectorAll('.notice-container').length}; .notice: ${document.querySelectorAll('.notice').length}; hits: ${hits.map((h) => h.parentElement?.outerHTML ?? '').join(' || ').slice(0, 800)}`;
}, LEAD);

// While the settings modal is open, activeWindow can differ from window here, and a Notice goes to activeWindow.document.
const notices = () => browser.executeObsidian(() => [...new Set([document, (window as unknown as { activeWindow?: Window }).activeWindow?.document ?? document])].flatMap((d) => [...d.querySelectorAll('.notice')]).map((n) => ({ text: n.textContent ?? '', buttons: n.querySelectorAll('.pf-pro-notice-sponsor').length })));

async function saved(): Promise<{ live: boolean; disk: boolean }> {
	return browser.executeObsidian(async ({ app }, id) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, { settings: { countFolded: boolean }; loadData(): Promise<{ countFolded?: boolean } | null> }> } }).plugins.plugins[id]!;
		return { live: p.settings.countFolded, disk: (await p.loadData())?.countFolded === true };
	}, pluginId);
}

async function openTab(): Promise<void> {
	await browser.executeObsidian(({ app }, id) => {
		const s = (app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting;
		s.open();
		s.openTabById(id);
	}, pluginId);
	try {
		await browser.waitUntil(async () => (await row(NAME)).found, { timeout: 15000 });
	} catch {
		const text = await browser.executeObsidian(({ app }) => ((app as unknown as { setting: { activeTab?: { containerEl: HTMLElement } } }).setting.activeTab?.containerEl.innerText ?? 'no active tab').slice(0, 800));
		throw new Error(`The Count folded lines row is not in the settings tab. Rows: ${(await probe(NAME, false)).names}. Tab text: ${text}`);
	}
}

async function reset(): Promise<void> {
	await browser.executeObsidian(async ({ app }, id) => {
		(app as unknown as { setting: { close(): void } }).setting.close();
		const p = (app as unknown as { plugins: { plugins: Record<string, { settings: { countFolded: boolean }; saveSettings(): Promise<void>; applySettings(): void; pro: { signOut(): void } | null }> } }).plugins.plugins[id]!;
		p.pro?.signOut();
		p.settings.countFolded = false;
		await p.saveSettings();
		p.applySettings();
	}, pluginId);
}

describe('Pro options in the settings tab', () => {
	before(reset);
	afterEach(reset);

	it('a free user who selects Count folded lines gets a Pro notice with a Sponsor button, and the option stays off', async () => {
		await openTab();
		const before = await row(NAME);
		expect(before).toEqual({ found: true, disabled: false, on: false });
		const count = await withLead();
		await clickToggle(NAME);
		try {
			await browser.waitUntil(async () => (await withLead()) > count, { timeout: 10000 });
		} catch {
			throw new Error(`No Pro notice after the free user selected Count folded lines. ${await diagnose()}`);
		}
		const notice = (await notices()).find((n) => n.text.includes(LEAD))!;
		expect(notice.text).toContain(`${LEAD} Sponsor on GitHub, then sign in from the plugin settings.`);
		expect(notice.buttons).toBe(1);
		expect(await saved()).toEqual({ live: false, disk: false });
		// The toggle shows the saved value again.
		await browser.waitUntil(async () => !(await row(NAME)).on, { timeout: 5000, timeoutMsg: 'The toggle stays on after the Pro notice.' });
	});

	it('a Pro user who selects Count folded lines saves the option, with no Pro notice', async () => {
		await browser.executeObsidian(async ({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, { pro: unknown }> } }).plugins.plugins[id]!;
			const manager = p.pro as { opts: { http: unknown }; refreshNow(): Promise<unknown>; isPro(): boolean };
			manager.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'fixture-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
			app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
			await manager.refreshNow();
			if (!manager.isPro()) throw new Error('The simulated Sponsors check did not turn Pro on.');
		}, pluginId);
		await openTab();
		expect((await row(NAME)).disabled).toBe(false);
		const count = await withLead();
		await clickToggle(NAME);
		await browser.waitUntil(async () => (await saved()).disk, { timeout: 5000, timeoutMsg: 'A Pro user could not save Count folded lines.' });
		expect(await saved()).toEqual({ live: true, disk: true });
		expect((await row(NAME)).on).toBe(true);
		expect(await withLead()).toBe(count);
	});
});
