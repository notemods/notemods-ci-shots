import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId, reloadPlugin } from './load';

const BASE = 'Bases Date Hierarchy/Projects.base';
async function open(view: string): Promise<void> {
	await browser.executeObsidian(async ({ app }, path, name) => { await app.workspace.openLinkText(`${path}#${name}`, '', false); }, BASE, view);
	await browser.waitUntil(async () => browser.execute((name: string) => { const root = document.querySelector('.workspace-leaf.mod-active .bases-date-hierarchy'); return root?.getAttribute('aria-label') === name && !!root.querySelector('.bdh-row'); }, view), { timeout: 15000, timeoutMsg: `View ${view} did not finish rendering` });
}
async function counts(): Promise<{ groups: number; notes: number; visible: number }> {
	return browser.execute(() => {
		const root = document.querySelector('.workspace-leaf.mod-active .bases-date-hierarchy');
		return { groups: root?.querySelectorAll('details').length ?? 0, notes: root?.querySelectorAll('.bdh-row').length ?? 0, visible: [...(root?.querySelectorAll<HTMLElement>('.bdh-row') ?? [])].filter((e) => !e.closest('details:not([open])')).length };
	});
}
async function button(text: string): Promise<void> {
	const buttons = await browser.$$('.workspace-leaf.mod-active .bdh-bar button');
	for (const b of buttons) if (await b.getText() === text) { await b.click(); return; }
	throw new Error(`Missing ${text}`);
}
describe('Bases Date Hierarchy real app', function () {
	it('loads and reloads without errors', async () => expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] }));
	it('shows six notes in nested groups, collapses and expands all', async () => {
		await open('By month');
		expect((await counts()).notes).toBe(6);
		expect((await counts()).groups).toBe(10);
		await button('Collapse all');
		await browser.waitUntil(async () => (await counts()).visible === 0);
		await button('Expand all');
		await browser.waitUntil(async () => (await counts()).visible === 6);
	});
	it('folds an individual group with the keyboard', async () => {
		await open('By month');
		const header = await browser.$('.workspace-leaf.mod-active .bdh-group > summary');
		await header.click();
		await browser.waitUntil(async () => (await counts()).visible < 6);
		await browser.keys('Enter');
		await browser.waitUntil(async () => (await counts()).visible === 6);
	});
	it('updates the hierarchy when a date changes', async () => {
		await open('By month');
		const path = 'Bases Date Hierarchy/Tasks/Draft scope.md';
		const setDate = async (date: string): Promise<void> => {
			await browser.executeObsidian(async ({ app }, p, value) => {
				const file = app.vault.getFileByPath(p);
				if (!file) throw new Error('Missing task fixture');
				await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => { fm.date = value; });
			}, path, date);
		};
		try {
			await setDate('2030-01-02');
			await browser.waitUntil(async () => browser.execute(() => [...document.querySelectorAll('.workspace-leaf.mod-active summary')].some((s) => s.textContent?.includes('2030'))), { timeout: 15000 });
			expect((await counts()).notes).toBe(6);
		} finally {
			await setDate('2026-10-21');
			await browser.waitUntil(async () => browser.execute(() => ![...document.querySelectorAll('.workspace-leaf.mod-active summary')].some((s) => s.textContent?.includes('2030'))), { timeout: 15000 });
		}
	});
	it('orders calendar years oldest first and keeps No date last', async () => {
  await open('Oldest first');
  const labels = await browser.execute(() => [...document.querySelectorAll('.workspace-leaf.mod-active .bases-date-hierarchy > details > summary')].map((e) => e.textContent));
  expect(labels[0]).toContain('2025'); expect(labels[labels.length - 1]).toContain('No date');
 });

 it('provides free ISO ranges and groups file creation and modification dates', async () => {
  await open('Free weeks');
  expect(await browser.$('.workspace-leaf.mod-active .bases-date-hierarchy').getText()).toContain('2025-12-29 to 2026-01-04');
  expect(await browser.$$('.workspace-leaf.mod-active .bdh-summary')).toHaveLength(0);
  await open('Creation time');
  expect((await counts()).notes).toBe(6);
  expect(await browser.$('.workspace-leaf.mod-active .bases-date-hierarchy').getText()).not.toContain('No date');
 });
 it('keeps one aligned table per month and renders invalid text as No date', async () => {
  await open('By month');
  expect(await browser.$$('.workspace-leaf.mod-active .bdh-table')).toHaveLength(4);
  expect(await browser.$('.workspace-leaf.mod-active .bases-date-hierarchy > details:last-child > summary').getText()).toContain('No date');
 });
 it('parses hand typed datetimes with a space and preserves the focused header on updates', async () => {
  await open('By month');
  await browser.execute(() => {
   const root = document.querySelector<HTMLElement>('.workspace-leaf.mod-active .bases-date-hierarchy')!;
   const summary = root.querySelector<HTMLElement>('summary')!; summary.focus(); (window as unknown as { testSummary: HTMLElement }).testSummary = summary;
  });
  await browser.executeObsidian(async ({ app }) => {
   const file = app.vault.getFileByPath('Bases Date Hierarchy/Tasks/Draft scope.md')!;
   await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => { fm.date = '2026-10-21 10:00'; });
  });
  await browser.pause(1300);
  expect(await browser.execute(() => document.activeElement === (window as unknown as { testSummary: HTMLElement }).testSummary)).toBe(true);
  expect((await counts()).groups).toBe(10);
  await browser.executeObsidian(async ({ app }) => {
   const file = app.vault.getFileByPath('Bases Date Hierarchy/Tasks/Draft scope.md')!;
   await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => { fm.date = '2026-10-21'; });
  });
 });
 it('supports internal link targets and middle click', async () => {
  await open('By month');
  const name = await browser.$('.workspace-leaf.mod-active .bdh-row a').getText();
  expect(await browser.$('.workspace-leaf.mod-active .bdh-row a').getAttribute('data-href')).toContain(name);
  await browser.execute(() => document.querySelector('.workspace-leaf.mod-active .bdh-row a')!.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true })));
  await browser.waitUntil(async () => browser.executeObsidian(({ app }, expected) => app.workspace.getActiveFile()?.basename === expected, name));
 });
	it('opens the note behind a table link', async () => {
		await open('By month');
		const name = await browser.$('.workspace-leaf.mod-active .bdh-row a').getText();
		await browser.$('.workspace-leaf.mod-active .bdh-row a').click();
		await browser.waitUntil(async () => browser.executeObsidian(({ app }, expected) => app.workspace.getActiveFile()?.basename === expected, name));
	});
	it('adds Pro week ranges and numeric summaries and restores saved folds', async () => {
		await browser.executeObsidian(async ({ app }, id) => {
			interface Pro { opts: { http: unknown }; refreshNow(): Promise<void> }
			const p = (app as unknown as { plugins: { plugins: Record<string, { pro: Pro }> } }).plugins.plugins[id]!;
			p.pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'test-example' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5', monthlyPriceInCents: 500 } } } } } });
			app.secretStorage.setSecret(`${id}-github-token`, `gho_${'0'.repeat(36)}`);
			await p.pro.refreshNow();
		}, pluginId);
		await open('Pro weeks');
		expect((await counts()).groups).toBe(9);
		expect(await browser.$('.workspace-leaf.mod-active .bdh-summary').getText()).toContain('Sum hours: 19');
		await button('Collapse all');
		await browser.waitUntil(async () => browser.executeObsidian(async ({ app }, path) => { const f = app.vault.getFileByPath(path); return !!f && (await app.vault.read(f)).includes('dateHierarchyCollapsed:'); }, BASE), { timeout: 15000 });
		await obsidianPage.openFile('Welcome.md');
		await open('Pro weeks');
		expect((await counts()).visible).toBe(0);
		await button('Expand all');
		await browser.executeObsidian(({ app }, id) => { (app as unknown as { plugins: { plugins: Record<string, { pro: { signOut(): void } }> } }).plugins.plugins[id]!.pro.signOut(); }, pluginId);
	});
});
