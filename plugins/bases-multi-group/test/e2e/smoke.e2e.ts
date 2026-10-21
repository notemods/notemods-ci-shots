import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId, reloadPlugin } from './load';

const BASE = 'Bases Multi Group/Projects.base';
async function open(view: string): Promise<void> {
	await browser.executeObsidian(async ({ app }, path, name) => { await app.workspace.openLinkText(`${path}#${name}`, '', false); }, BASE, view);
	await browser.waitUntil(async () => browser.execute((name: string) => { const root = document.querySelector('.workspace-leaf.mod-active .bases-multi-group'); return root?.getAttribute('aria-label') === name && !!root.querySelector('.bmg-row'); }, view), { timeout: 15000, timeoutMsg: `View ${view} did not finish rendering` });
}
async function counts(): Promise<{ groups: number; notes: number; visible: number }> {
	return browser.execute(() => {
		const root = document.querySelector('.workspace-leaf.mod-active .bases-multi-group');
		return { groups: root?.querySelectorAll('details').length ?? 0, notes: root?.querySelectorAll('.bmg-row').length ?? 0, visible: [...(root?.querySelectorAll<HTMLElement>('.bmg-row') ?? [])].filter((e) => !e.closest('details:not([open])')).length };
	});
}
async function button(text: string): Promise<void> {
	const buttons = await browser.$$('.workspace-leaf.mod-active .bmg-bar button');
	for (const b of buttons) if (await b.getText() === text) { await b.click(); return; }
	throw new Error(`Missing ${text}`);
}
describe('Bases Multi Group real app', function () {
	it('loads and reloads without errors', async () => expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] }));
	it('shows six notes in nested groups, collapses and expands all', async () => {
		await open('By status and project');
		expect((await counts()).notes).toBe(6);
		expect((await counts()).groups).toBe(7);
		await button('Collapse all');
		await browser.waitUntil(async () => (await counts()).visible === 0);
		await button('Expand all');
		await browser.waitUntil(async () => (await counts()).visible === 6);
	});
	it('folds an individual group with the keyboard', async () => {
		await open('By status and project');
		const header = await browser.$('.workspace-leaf.mod-active .bmg-group > summary');
		await header.click();
		await browser.waitUntil(async () => (await counts()).visible < 6);
		await browser.keys('Enter');
		await browser.waitUntil(async () => (await counts()).visible === 6);
	});
	it('updates a group when a note property changes', async () => {
		await open('By status and project');
		const path = 'Bases Multi Group/Tasks/Draft scope.md';
		const setProject = async (project: string): Promise<void> => {
			await browser.executeObsidian(async ({ app }, p, value) => {
				const file = app.vault.getFileByPath(p);
				if (!file) throw new Error('Missing task fixture');
				await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => { fm.project = value; });
			}, path, project);
		};
		try {
			await setProject('Delta');
			await browser.waitUntil(async () => browser.execute(() => [...document.querySelectorAll('.workspace-leaf.mod-active summary')].some((s) => s.textContent?.includes('Delta'))), { timeout: 15000 });
			expect((await counts()).notes).toBe(6);
		} finally {
			await setProject('Atlas');
			await browser.waitUntil(async () => browser.execute(() => ![...document.querySelectorAll('.workspace-leaf.mod-active summary')].some((s) => s.textContent?.includes('Delta'))), { timeout: 15000 });
		}
	});
	it('duplicates list notes across groups without changing the base query', async () => {
		await open('Split work');
		expect((await counts()).notes).toBe(8);
	});
	it('opens the note behind a table link', async () => {
		await open('By status and project');
		const name = await browser.$('.workspace-leaf.mod-active .bmg-row a').getText();
		await browser.$('.workspace-leaf.mod-active .bmg-row a').click();
		await browser.waitUntil(async () => browser.executeObsidian(({ app }, expected) => app.workspace.getActiveFile()?.basename === expected, name));
	});
	it('adds Pro third level and numeric summaries and restores saved folds', async () => {
		await browser.executeObsidian(async ({ app }, id) => {
			interface Pro { opts: { http: unknown }; refreshNow(): Promise<void> }
			const p = (app as unknown as { plugins: { plugins: Record<string, { pro: Pro }> } }).plugins.plugins[id]!;
			p.pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'test-example' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5', monthlyPriceInCents: 500 } } } } } });
			app.secretStorage.setSecret(`${id}-github-token`, `gho_${'0'.repeat(36)}`);
			await p.pro.refreshNow();
		}, pluginId);
		await open('Pro example');
		expect((await counts()).groups).toBe(13);
		expect(await browser.$('.workspace-leaf.mod-active .bmg-summary').getText()).toContain('Sum hours: 8');
		await button('Collapse all');
		await browser.waitUntil(async () => browser.executeObsidian(async ({ app }, path) => { const f = app.vault.getFileByPath(path); return !!f && (await app.vault.read(f)).includes('multiGroupCollapsed:'); }, BASE), { timeout: 15000 });
		await obsidianPage.openFile('Welcome.md');
		await open('Pro example');
		expect((await counts()).visible).toBe(0);
		await button('Expand all');
		await browser.executeObsidian(({ app }, id) => { (app as unknown as { plugins: { plugins: Record<string, { pro: { signOut(): void } }> } }).plugins.plugins[id]!.pro.signOut(); }, pluginId);
	});
});
