import { browser, expect } from '@wdio/globals';
import { resetSettings, writeFixture, type TestPlugins } from './load';

// A free user can select the Pro rows of the settings tab and can preview a pass with more than 10 note copies.
// Each one shows the shared Pro notice with the "Sponsor on GitHub" button. The rows show the values in effect and
// nothing is saved. A Pro user changes the same rows.
const ID = 'craft-link-repair';
const OUTPUT = 'Output folder, date note folder and date format choices need Pro.';
const AUTO = 'Repair new exports needs Pro.';
const LIMIT = 'A pass with more than 10 note copies needs Pro.';
type Notices = { text: string; sponsor: number }[];

const notices = (): Promise<Notices> => browser.executeObsidian(() => [...activeWindow.document.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', sponsor: n.querySelectorAll('.pf-pro-notice-sponsor').length })));
const clearNotices = () => browser.executeObsidian(() => { activeWindow.document.querySelectorAll('.notice').forEach((n) => n.remove()); });

async function openTab(): Promise<void> {
	await browser.executeObsidian(({ app }, id) => {
		const setting = (app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting;
		setting.open();
		setting.openTabById(id);
	}, ID);
	await browser.waitUntil(async () => (await row('Repair new exports (Pro)', null)).found, { timeout: 10000, timeoutMsg: 'The settings tab did not show the Pro rows.' });
}

async function closeTab(): Promise<void> {
	await browser.executeObsidian(({ app }) => { (app as unknown as { setting: { close(): void } }).setting.close(); });
	await clearNotices();
}

interface Row { found: boolean; on: boolean; value: string; disabled: boolean }

/**
 * Finds the row with this name in the open settings tab. action 'click' selects its toggle, a string sets its select
 * or text input to that value (as the user does). A real select moves the focus into the row, so the test focuses it.
 */
async function row(name: string, action: string | null): Promise<Row> {
	return browser.executeObsidian(({ app }, label, act) => {
		const tab = (app as unknown as { setting: { activeTab?: { containerEl: HTMLElement } } }).setting.activeTab;
		const root: HTMLElement = tab?.containerEl ?? activeDocument.body;
		const nameEl = [...root.querySelectorAll<HTMLElement>('.setting-item-name')].find((el) => el.textContent?.trim() === label);
		const item = nameEl?.closest<HTMLElement>('.setting-item');
		if (!item) return { found: false, on: false, value: '', disabled: false };
		const box = item.querySelector<HTMLElement>('.checkbox-container');
		const select = item.querySelector<HTMLSelectElement>('select');
		const input = item.querySelector<HTMLInputElement>('input[type="text"], input:not([type])');
		if (act === 'click' && box) { box.focus(); box.click(); }
		else if (act !== null && select) { select.focus(); select.value = act; select.dispatchEvent(new Event('change', { bubbles: true })); }
		else if (act !== null && input) { input.focus(); input.value = act; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); }
		const control = box ?? select ?? input;
		return {
			found: true,
			on: !!box?.classList.contains('is-enabled'),
			value: select?.value ?? input?.value ?? '',
			disabled: item.classList.contains('is-disabled') || !!box?.classList.contains('is-disabled') || !!select?.disabled || !!input?.disabled || !control,
		};
	}, name, action);
}

async function stored(): Promise<string> {
	return browser.executeObsidian(async ({ app }, id) => {
		const p = (app as unknown as { plugins: TestPlugins }).plugins.plugins[id] as unknown as { settings: unknown; loadData(): Promise<unknown> };
		const disk = (await p.loadData()) as Record<string, unknown> | null;
		const { receipts: _r, ...rest } = disk ?? {};
		return JSON.stringify({ memory: p.settings, disk: rest });
	}, ID);
}

async function waitNotice(lead: string, what: string): Promise<void> {
	await browser.waitUntil(async () => (await notices()).some((n) => n.text.includes(lead) && n.sponsor === 1), { timeout: 5000, timeoutMsg: `No Pro notice with a Sponsor button after ${what}: ${JSON.stringify(await notices())}` });
}

describe('Craft Link Repair Pro notice', function () {
	afterEach(async function () {
		await closeTab();
		await browser.executeObsidian(({ app }) => { activeWindow.document.querySelectorAll('.modal-close-button').forEach((b) => (b as HTMLElement).click()); void app; });
		await resetSettings('');
	});

	it('a free user who selects a Pro row gets a Pro notice with a Sponsor button, the row shows the value in effect and nothing is saved', async function () {
		await resetSettings('');
		await clearNotices();
		const before = await stored();
		await openTab();
		expect(await row('Repair new exports (Pro)', null)).toEqual({ found: true, on: false, value: '', disabled: false });
		expect((await row('Date format (Pro)', null)).disabled).toBe(false);

		await row('Repair new exports (Pro)', 'click');
		await waitNotice(AUTO, 'Repair new exports');
		await browser.waitUntil(async () => !(await row('Repair new exports (Pro)', null)).on, { timeout: 5000, timeoutMsg: 'The Repair new exports toggle did not go back to off.' });

		await clearNotices();
		await row('Date format (Pro)', 'YYYY.MM.DD');
		await waitNotice(OUTPUT, 'Date format');
		await browser.waitUntil(async () => (await row('Date format (Pro)', null)).value === 'YYYY-MM-DD', { timeout: 5000, timeoutMsg: 'The Date format row did not go back to YYYY-MM-DD.' });

		await clearNotices();
		await row('Output folder (Pro)', 'Copies');
		await waitNotice(OUTPUT, 'Output folder');
		await browser.waitUntil(async () => (await row('Output folder (Pro)', null)).value === '', { timeout: 5000, timeoutMsg: 'The Output folder row did not go back to empty.' });

		expect(await stored()).toBe(before);
	});

	it('a free preview of 11 note copies shows the Pro notice with a Sponsor button, and Write copies stays disabled', async function () {
		for (let i = 0; i < 11; i++) await writeFixture(`E2E/ProLimit/${i}.md`, 'note');
		await resetSettings('E2E/ProLimit');
		await clearNotices();
		await browser.executeObsidianCommand('craft-link-repair:preview-repair');
		const modal = browser.$('.craft-repair'); await modal.waitForDisplayed({ timeout: 30000 });
		await modal.$('button=Preview links').click();
		await browser.waitUntil(async () => (await modal.getText()).includes('Free limit: 11 notes exceeds 10.'), { timeout: 30000, timeoutMsg: 'The preview did not show the free limit.' });
		await waitNotice(LIMIT, 'the preview');
		expect(await modal.$('button=Write copies').isEnabled()).toBe(false);
		expect(await browser.executeObsidian(({ app }) => app.vault.getAbstractFileByPath('E2E/ProLimit/0.repaired.md') === null)).toBe(true);
	});

	it('a Pro user who selects Repair new exports turns it on, with no Pro notice', async function () {
		await resetSettings('', true);
		await clearNotices();
		await openTab();
		await row('Repair new exports (Pro)', 'click');
		await browser.waitUntil(async () => (JSON.parse(await stored()) as { memory: { automatic: boolean } }).memory.automatic, { timeout: 5000, timeoutMsg: 'A Pro user could not turn on Repair new exports.' });
		expect((await row('Repair new exports (Pro)', null)).on).toBe(true);
		expect((await notices()).filter((n) => n.sponsor > 0)).toEqual([]);
	});
});
