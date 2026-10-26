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

/** Marks the Add folder button and the override property input of the open settings tab, so that the test can find them again. Returns true when both exist. */
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
	}, pluginId);
}

/** Selects the Add folder button in the settings tab (a DOM click: a disabled button ignores it). */
const clickAddFolder = () => browser.executeObsidian(({ app }) => {
	const root = (app as unknown as { setting: { activeTab: { containerEl: HTMLElement } } }).setting.activeTab.containerEl;
	const button = root.querySelector<HTMLButtonElement>('[data-g10-test="add-folder"]');
	if (!button) throw new Error('No Add folder button');
	button.click();
	return { disabled: button.disabled, connected: button.isConnected };
});

/** Types one character at the end of the override property field, as a key press does (focus, new value, input event). */
const typeInOverride = (key: string) => browser.executeObsidian(({ app }, ch) => {
	const root = (app as unknown as { setting: { activeTab: { containerEl: HTMLElement } } }).setting.activeTab.containerEl;
	const input = root.querySelector<HTMLInputElement>('[data-g10-test="override"]');
	if (!input) throw new Error('No override property field');
	input.focus();
	input.value += ch;
	input.dispatchEvent(new Event('input', { bubbles: true }));
}, key);

const overrideField = () => browser.executeObsidian(({ app }) => {
	const root = (app as unknown as { setting: { activeTab: { containerEl: HTMLElement } } }).setting.activeTab.containerEl;
	const input = root.querySelector<HTMLInputElement>('[data-g10-test="override"]');
	return { value: input?.value ?? null, focused: !!input && input.ownerDocument.activeElement === input };
});

/** The notices in the main window, in the active window and in the window of the settings tab. While the settings are open, Obsidian adds a notice to the active window (activeDocument), which is not the window of the test script. */
const notices = () => browser.executeObsidian(({ app }) => {
	const tab = (app as unknown as { setting: { activeTab: { containerEl: HTMLElement } | null } }).setting.activeTab;
	const docs = new Set([document, (window as unknown as { activeDocument?: Document }).activeDocument ?? document, tab?.containerEl.ownerDocument ?? document]);
	return [...docs].flatMap((d) => [...d.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', buttons: n.querySelectorAll('.pf-pro-notice-sponsor').length })));
});

/** Waits for a new notice with the lead: more of them than `before`. */
async function proNotice(lead: string, before: number): Promise<{ text: string; buttons: number }> {
	try {
		await browser.waitUntil(async () => (await notices()).filter((n) => n.text.includes(lead)).length > before, { timeout: 5000 });
	} catch {
		const probe = await browser.executeObsidian((_, text) => {
			const activeDocument = (window as unknown as { activeDocument?: Document }).activeDocument ?? document;
			return {
				inBody: activeDocument.body.innerText.includes(text),
				containers: activeDocument.querySelectorAll('.notice-container').length,
				holders: [...activeDocument.querySelectorAll('body *')].filter((e) => e.children.length === 0 && (e.textContent ?? '').includes(text)).map((e) => e.parentElement?.outerHTML.slice(0, 300)),
			};
		}, lead);
		throw new Error(`No new Pro notice with "${lead}". Probe: ${JSON.stringify(probe)}`);
	}
	const all = (await notices()).filter((n) => n.text.includes(lead));
	return all[all.length - 1]!;
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
		const count = async (lead: string) => (await notices()).filter((n) => n.text.includes(lead)).length;
		const foldersBefore = await count(FOLDERS_LEAD);
		const clicked = await clickAddFolder();
		expect(clicked).toEqual({ disabled: false, connected: true });
		const folders = await proNotice(FOLDERS_LEAD, foldersBefore);
		expect(folders.text).toContain(`${FOLDERS_LEAD} ${PITCH}`);
		expect(folders.buttons).toBe(1);
		expect(await stored()).toEqual({ folders: 0, override: 'fold-stop', savedFolders: 0, savedOverride: 'fold-stop' });

		const overrideBefore = await count(OVERRIDE_LEAD);
		await typeInOverride('x');
		const override = await proNotice(OVERRIDE_LEAD, overrideBefore);
		expect(override.text).toContain(`${OVERRIDE_LEAD} ${PITCH}`);
		expect(override.buttons).toBe(1);
		// One edit attempt gives one notice, not one for each key.
		expect(await count(OVERRIDE_LEAD)).toBe(overrideBefore + 1);
		expect(await stored()).toEqual({ folders: 0, override: 'fold-stop', savedFolders: 0, savedOverride: 'fold-stop' });
		// The tab is drawn again: the new field shows the stored value and does not have the focus, so the next key does not reach it.
		await browser.waitUntil(async () => (await markControls()) && (await overrideField()).value === 'fold-stop', { timeout: 5000, timeoutMsg: 'The override field does not show the stored value.' });
		expect((await overrideField()).focused).toBe(false);
		await closeSettings();
	});

	it('a Pro user who selects Add folder gets a new folder rule and no notice', async () => {
		await openSettings(true);
		const before = (await notices()).filter((n) => n.text.includes(FOLDERS_LEAD)).length;
		await clickAddFolder();
		await browser.waitUntil(async () => (await stored()).folders === 1, { timeout: 5000, timeoutMsg: 'Add folder did not add a rule for a Pro user.' });
		expect((await notices()).filter((n) => n.text.includes(FOLDERS_LEAD)).length).toBe(before);
		await closeSettings();
	});
});
