import { browser, expect } from '@wdio/globals';
import type TaskFieldLabelsPlugin from '../../src/main';
import type { SponsorsManager } from '../../src/license/index';

// A free user can select the Pro rows of the settings tab. A select shows the shared Pro notice with the
// "Sponsor on GitHub" button. Nothing is saved, and the row shows the value in effect. A Pro user turns Compact on.
type Host = { plugins: { plugins: Record<string, TaskFieldLabelsPlugin> }; setting: { open(): void; close(): void; openTabById(id: string): void; activeTab?: { containerEl: HTMLElement } } };
const LABELS_LEAD = 'Custom field labels and the compact layout need Pro.';
const PRESETS_LEAD = 'Display presets and folder rules need Pro.';

async function setPro(on: boolean): Promise<boolean> {
	return browser.executeObsidian(async ({ app }, enabled) => {
		const p = (app as unknown as Host).plugins.plugins['task-field-labels']!;
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

async function openTab(): Promise<void> {
	await browser.executeObsidian(({ app }) => {
		const s = (app as unknown as Host).setting; s.open(); s.openTabById('task-field-labels');
		(window as unknown as { activeWindow: Window }).activeWindow.document.querySelectorAll('.notice').forEach((n) => n.remove());
	});
}

/** The row with this name: its toggle state or text value. With act, a real select: focus and click the toggle, or type one key. */
async function row(name: string, act: 'click' | 'type' | null) {
	return browser.executeObsidian(({ app }, name, act) => {
		const root = (app as unknown as Host).setting.activeTab?.containerEl ?? document.body;
		const item = [...root.querySelectorAll<HTMLElement>('.setting-item')].find((r) => r.querySelector('.setting-item-name')?.textContent === name);
		if (!item) return null;
		const box = item.querySelector<HTMLElement>('.checkbox-container');
		const text = item.querySelector<HTMLInputElement | HTMLTextAreaElement>('input[type="text"], input:not([type]), textarea');
		const disabled = item.classList.contains('is-disabled') || !!text?.disabled || !!box?.classList.contains('is-disabled');
		if (act === 'click' && box) { box.focus(); box.click(); }
		if (act === 'type' && text) { text.focus(); text.value = text.value + 'x'; text.dispatchEvent(new Event('input', { bubbles: true })); text.dispatchEvent(new Event('change', { bubbles: true })); }
		return { disabled, on: box ? box.classList.contains('is-enabled') : null, value: text ? text.value : null };
	}, name, act);
}

async function state() {
	return browser.executeObsidian(async ({ app }) => {
		const p = (app as unknown as Host).plugins.plugins['task-field-labels']!;
		return {
			notices: [...(window as unknown as { activeWindow: Window }).activeWindow.document.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', sponsor: n.querySelectorAll('.pf-pro-notice-sponsor').length })),
			saved: JSON.stringify((await p.loadData()) ?? {}),
			settings: JSON.stringify(p.settings),
		};
	});
}

describe('Pro rows of the settings tab', function () {
	afterEach(async () => {
		await setPro(false);
		await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as Host).plugins.plugins['task-field-labels']!;
			p.settings.compact = false; await p.saveSettings();
			(app as unknown as Host).setting.close();
		});
	});

	it('a free user who selects Compact field layout or types in Due label gets the Pro notice with a Sponsor button, nothing is saved, and the rows show the values in effect', async () => {
		expect(await setPro(false)).toBe(false);
		await openTab();
		const before = await state();
		const compact = await row('Compact field layout (Pro)', 'click');
		expect(compact?.disabled).toBe(false);
		await browser.pause(400);
		expect((await row('Compact field layout (Pro)', null))?.on).toBe(false);
		const due = await row('Due label (Pro)', 'type');
		expect(due?.disabled).toBe(false);
		await browser.pause(400);
		expect((await row('Due label (Pro)', null))?.value).toBe('Due');
		const folder = await row('Folder rules (Pro)', 'type');
		expect(folder?.disabled).toBe(false);
		await browser.pause(400);
		expect((await row('Folder rules (Pro)', null))?.value).toBe('');
		const after = await state();
		if (!after.notices.some((n) => n.text.includes(LABELS_LEAD) && n.sponsor === 1)) throw new Error(`No labels Pro notice: ${JSON.stringify(after.notices)}`);
		if (!after.notices.some((n) => n.text.includes(PRESETS_LEAD) && n.sponsor === 1)) throw new Error(`No presets Pro notice: ${JSON.stringify(after.notices)}`);
		expect(after.saved).toBe(before.saved);
		expect(after.settings).toBe(before.settings);
	});

	it('a Pro user who selects Compact field layout turns it on, with no Pro notice', async () => {
		expect(await setPro(true)).toBe(true);
		await openTab();
		await row('Compact field layout (Pro)', 'click');
		await browser.pause(400);
		expect((await row('Compact field layout (Pro)', null))?.on).toBe(true);
		const after = await state();
		expect(after.settings).toContain('"compact":true');
		expect(after.notices.filter((n) => n.sponsor > 0)).toEqual([]);
	});
});
