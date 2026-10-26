import { browser, expect } from '@wdio/globals';
import { pluginId } from './load';
import type { HrFoldStopSettings } from '../../src/settings';

interface TestPlugin {
	settings: HrFoldStopSettings;
	settingTab: { update(): void };
	pro: { signOut(): void; opts: { http: unknown }; refreshNow(): Promise<unknown> };
	saveSettings(): Promise<void>;
	loadData(): Promise<unknown>;
}

const FOLDERS_LEAD = 'Folder rules that turn Fold Stop on or off for each folder need Pro.';
const OVERRIDE_LEAD = 'A note property that overrides the folder and vault rules needs Pro.';
const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';
const ADD_FOLDER = '[data-g10-test="add-folder"]';
const OVERRIDE_INPUT = '[data-g10-test="override"]';

/** Marks the Add folder button and the override property input of the open settings tab, so that wdio can select them. Returns true when both exist. */
const markControls = () => browser.executeObsidian(({ app }) => {
	const tab = (app as unknown as { setting: { activeTab: { containerEl: HTMLElement } | null } }).setting.activeTab;
	const root = tab?.containerEl;
	if (!root) return false;
	const button = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Add folder');
	const label = [...root.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent?.trim() === 'Override property (Pro)');
	let row: Element | null = label ?? null;
	while (row && !row.querySelector('input')) row = row.parentElement;
	const input = row?.querySelector('input');
	button?.setAttribute('data-g10-test', 'add-folder');
	input?.setAttribute('data-g10-test', 'override');
	return !!button && !!input;
});

/** Resets the settings, sets the Pro state and opens the plugin settings tab. */
async function openSettings(paid: boolean): Promise<void> {
	await browser.executeObsidian(async ({ app }, id, pro) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, TestPlugin> } }).plugins.plugins[id]!;
		p.pro.signOut();
		p.settings = { enabled: true, endMarkers: true, folders: [], overrideProperty: 'fold-stop' };
		await p.saveSettings();
		if (pro) {
			p.pro.opts.http = () => Promise.resolve({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
			app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
			await p.pro.refreshNow();
		}
		document.querySelectorAll('.notice').forEach((n) => n.remove());
		p.settingTab.update();
		const setting = (app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting;
		setting.open();
		setting.openTabById(id);
	}, pluginId, paid);
	try {
		await browser.waitUntil(markControls, { timeout: 20000 });
	} catch {
		const seen = await browser.executeObsidian(({ app }) => {
			const setting = (app as unknown as { setting: { activeTab: { id?: string; containerEl: HTMLElement } | null; containerEl?: HTMLElement } }).setting;
			return { tab: setting.activeTab?.id ?? null, open: !!setting.containerEl?.isConnected, modals: document.querySelectorAll('.modal').length, text: setting.activeTab?.containerEl.innerText.slice(0, 400) ?? '' };
		});
		throw new Error(`The Add folder button or the override property field is not in the settings tab. Seen: ${JSON.stringify(seen)}`);
	}
}

async function closeSettings(): Promise<void> {
	await browser.executeObsidian(async ({ app }, id) => {
		(app as unknown as { setting: { close(): void } }).setting.close();
		const p = (app as unknown as { plugins: { plugins: Record<string, TestPlugin> } }).plugins.plugins[id]!;
		p.pro.signOut();
		p.settings = { enabled: true, endMarkers: true, folders: [], overrideProperty: 'fold-stop' };
		await p.saveSettings();
		document.querySelectorAll('.notice').forEach((n) => n.remove());
	}, pluginId);
}

const notices = () => browser.executeObsidian(() => [...document.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', buttons: n.querySelectorAll('.pf-pro-notice-sponsor').length })));

async function proNotice(lead: string): Promise<{ text: string; buttons: number }> {
	await browser.waitUntil(async () => (await notices()).some((n) => n.text.includes(lead)), { timeout: 5000, timeoutMsg: `No Pro notice with "${lead}".` });
	return (await notices()).find((n) => n.text.includes(lead))!;
}

const stored = () => browser.executeObsidian(async ({ app }, id) => {
	const p = (app as unknown as { plugins: { plugins: Record<string, TestPlugin> } }).plugins.plugins[id]!;
	const data = (await p.loadData()) as Partial<HrFoldStopSettings> | null;
	return { folders: p.settings.folders.length, override: p.settings.overrideProperty, savedFolders: data?.folders?.length ?? 0, savedOverride: data?.overrideProperty ?? null };
}, pluginId);

describe('Pro notice in the settings tab', () => {
	after(closeSettings);

	it('a free user who selects Add folder or edits the override property gets a Pro notice with a Sponsor button, and no setting changes', async () => {
		await openSettings(false);
		await browser.$(ADD_FOLDER).click();
		const folders = await proNotice(FOLDERS_LEAD);
		expect(folders.text).toContain(`${FOLDERS_LEAD} ${PITCH}`);
		expect(folders.buttons).toBe(1);
		expect(await stored()).toEqual({ folders: 0, override: 'fold-stop', savedFolders: 0, savedOverride: 'fold-stop' });

		const input = browser.$(OVERRIDE_INPUT);
		await input.click();
		await browser.keys(['x', 'y']);
		const override = await proNotice(OVERRIDE_LEAD);
		expect(override.text).toContain(`${OVERRIDE_LEAD} ${PITCH}`);
		expect(override.buttons).toBe(1);
		// One edit attempt gives one notice, not one for each key.
		expect((await notices()).filter((n) => n.text.includes(OVERRIDE_LEAD)).length).toBe(1);
		expect(await stored()).toEqual({ folders: 0, override: 'fold-stop', savedFolders: 0, savedOverride: 'fold-stop' });
		await browser.waitUntil(async () => (await markControls()) && (await browser.$(OVERRIDE_INPUT).getValue()) === 'fold-stop', { timeout: 5000, timeoutMsg: 'The override field does not show the stored value.' });
		await closeSettings();
	});

	it('a Pro user who selects Add folder gets a new folder rule and no notice', async () => {
		await openSettings(true);
		await browser.$(ADD_FOLDER).click();
		await browser.waitUntil(async () => (await stored()).folders === 1, { timeout: 5000, timeoutMsg: 'Add folder did not add a rule for a Pro user.' });
		expect((await notices()).some((n) => n.text.includes(FOLDERS_LEAD))).toBe(false);
		await closeSettings();
	});
});
