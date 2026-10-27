import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId } from './load';

const LEAD = 'Custom rank properties need Pro.';

interface Manager { opts: { http: unknown }; refreshNow(): Promise<unknown>; signOut(): void; isPro(): boolean }

/** Ranks of the three fixture notes, read from the metadata cache. */
async function ranks(): Promise<Record<string, unknown>> {
	return browser.executeObsidian(({ app }) => {
		const out: Record<string, unknown> = {};
		for (const name of ['Rank A', 'Rank B', 'Rank C']) {
			const fm = app.metadataCache.getFileCache(app.vault.getFileByPath(`${name}.md`)!)?.frontmatter;
			out[name] = { priority: fm?.priority, manual_order: fm?.manual_order };
		}
		return out;
	});
}

async function openBase(): Promise<void> {
	await obsidianPage.write('Rank A.md', '---\npriority: 1024\n---\nBody A');
	await obsidianPage.write('Rank B.md', '---\npriority: 2048\n---\nBody B');
	await obsidianPage.write('Rank C.md', '---\npriority: 3072\n---\nBody C');
	await obsidianPage.write('Rank.base', 'filters: \'file.name.startsWith("Rank ")\'\nviews:\n  - type: bases-manual-order\n    name: Custom\n    manualRank: priority\n    order: [file.name, note.priority]\n');
	await obsidianPage.openFile('Rank.base');
	await browser.waitUntil(async () => (await browser.$$('.bmo-view tbody tr').length) === 3, { timeout: 15000, timeoutMsg: 'The base did not show 3 rows.' });
}

/** Await actual DOM and vault state. Do not use a sleep or a theme selector. */
describe('custom rank property Pro gate', () => {
	it('a free user who moves a note with a custom rank property gets the Pro notice with a Sponsor button and no write', async () => {
		await browser.executeObsidian(({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, { pro: Manager | null }> } }).plugins.plugins[id]!;
			p.pro?.signOut();
			document.querySelectorAll('.notice').forEach((n) => n.remove());
		}, pluginId);
		await openBase();
		const before = await ranks();
		expect(await browser.$('.bmo-view').getText()).toContain('Moving rows in this custom ordering needs Pro.');
		const up = browser.$('.bmo-view button[aria-label="Move Rank C up"]');
		await up.waitForExist({ timeout: 10000, timeoutMsg: 'A free user has no Move up button for a custom rank property.' });
		expect(await up.isEnabled()).toBe(true);
		await up.click();
		const notices = () => browser.executeObsidian(() => [...document.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', buttons: n.querySelectorAll('.pf-pro-notice-sponsor').length })));
		await browser.waitUntil(async () => (await notices()).some((n) => n.text.includes(LEAD)), { timeout: 5000, timeoutMsg: 'No Pro notice after Move up.' });
		const notice = (await notices()).find((n) => n.text.includes(LEAD))!;
		expect(notice.text).toContain(`${LEAD} Sponsor on GitHub, then sign in from the plugin settings.`);
		expect(notice.buttons).toBe(1);
		expect((await notices()).some((n) => n.text.includes('Could not complete the move'))).toBe(false);
		// The drop path goes through the same gate.
		await browser.execute(() => {
			const rows = Array.from(document.querySelectorAll<HTMLElement>('.bmo-view tbody tr'));
			const from = rows.find((row) => row.dataset.path === 'Rank C.md')!;
			const to = rows.find((row) => row.dataset.path === 'Rank A.md')!;
			const dataTransfer = new DataTransfer();
			from.querySelector('[draggable]')!.dispatchEvent(new DragEvent('dragstart', { dataTransfer, bubbles: true }));
			to.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }));
		});
		expect(await ranks()).toEqual(before);
		const files = await browser.executeObsidian(({ app }) => Promise.all(['Rank A', 'Rank B', 'Rank C'].map((n) => app.vault.read(app.vault.getFileByPath(`${n}.md`)!))));
		expect(files).toEqual(['---\npriority: 1024\n---\nBody A', '---\npriority: 2048\n---\nBody B', '---\npriority: 3072\n---\nBody C']);
		await browser.executeObsidian(() => document.querySelectorAll('.notice').forEach((n) => n.remove()));
	});

	it('a Pro user moves a note with a custom rank property', async () => {
		await openBase();
		const pro = await browser.executeObsidian(async ({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, { pro: Manager | null }> } }).plugins.plugins[id]!;
			if (!p.pro) throw new Error('Sponsors manager missing');
			const manager = p.pro;
			manager.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'fixture-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
			app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
			await manager.refreshNow();
			return manager.isPro();
		}, pluginId);
		try {
			expect(pro).toBe(true);
			// A WebDriver click on the redrawn view was not interactable on CI. The test selects the visible, enabled
			// button through the DOM, as the drag test in smoke.e2e.ts does, and waits until the Pro redraw has that button.
			const view = '.bmo-view';
			await browser.waitUntil(async () => !(await browser.$(view).getText()).includes('Moving rows in this custom ordering needs Pro.'), { timeout: 10000, timeoutMsg: 'The view did not redraw for Pro.' });
			await browser.waitUntil(() => browser.execute(() => {
				const button = [...document.querySelectorAll<HTMLButtonElement>('.bmo-view button[aria-label="Move Rank C up"]')].find((b) => b.offsetParent !== null && !b.disabled);
				button?.click();
				return !!button;
			}), { timeout: 10000, timeoutMsg: 'A Pro user has no visible Move up button.' });
			await browser.waitUntil(async () => ((await ranks())['Rank C'] as { priority: unknown }).priority === 1536, { timeout: 10000, timeoutMsg: 'Move up did not write the custom rank for a Pro user.' });
			// The move writes only the custom property. manual_order stays absent (undefined comes back as null).
			const text = await browser.executeObsidian(({ app }) => app.vault.read(app.vault.getFileByPath('Rank C.md')!));
			expect(text).toBe('---\npriority: 1536\n---\nBody C');
			const texts = await browser.executeObsidian(() => [...document.querySelectorAll('.notice')].map((n) => n.textContent ?? ''));
			expect(texts.some((t) => t.includes(LEAD))).toBe(false);
		} finally {
			await browser.executeObsidian(({ app }, id) => {
				(app as unknown as { plugins: { plugins: Record<string, { pro: Manager | null }> } }).plugins.plugins[id]!.pro?.signOut();
			}, pluginId);
		}
	});
});
