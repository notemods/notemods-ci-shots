import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId } from './load';

// Choices for one view: a base with the views "Wide" (3 frozen columns, Pro) and "Narrow" (off).
// The choices are made through the command modal, then the test switches views in the same tab.
// Pro uses a stubbed GitHub reply, so no request leaves the app.
const DIR = 'Bases Freeze Panes';
const BASE = `${DIR}/Shelf views.base`;
const RENAMED = `${DIR}/Shelf views renamed.base`;
const TOKEN_ID = `${pluginId}-github-token`;

interface ViewProbe {
	view: string | null;
	scroll: number;
	frozen: number;
	rows: number;
	/** Left edge of the first three cells of the first body row before the scroll and after it. */
	before: number[];
	after: number[];
}

type PluginShape = {
	settings: { files: Record<string, { views?: Record<string, unknown> }>; columns: number };
	pro: { opts: { http: unknown }; refreshNow(): Promise<void>; signOut(): void };
	isPro(): boolean;
	refresh(): void;
	saveSettings(): Promise<void>;
};

/** Picks a view in the base tab, the same as the view menu in the toolbar does. */
async function selectView(name: string): Promise<void> {
	await browser.executeObsidian(({ app }, n) => {
		const view = app.workspace.getMostRecentLeaf()?.view as unknown as { controller?: { selectView(v: string): void } };
		view.controller?.selectView(n);
	}, name);
	await browser.waitUntil(
		async () =>
			browser.execute((n: string) => {
				const v = Array.from(document.querySelectorAll<HTMLElement>('.workspace-leaf.mod-active .bases-view')).find((x) => x.offsetParent !== null);
				return v?.getAttribute('data-view-name') === n && v.querySelector('.bases-tbody > .bases-tr') !== null;
			}, name),
		{ timeout: 15000, timeoutMsg: `view ${name} did not show rows` },
	);
	await browser.pause(500);
}

/** Scrolls the visible table to the start, then `left` px right, and measures the first body row. */
async function probe(left: number): Promise<ViewProbe | null> {
	return browser.executeAsync((l: number, done: (p: ViewProbe | null) => void) => {
		const v = Array.from(document.querySelectorAll<HTMLElement>('.workspace-leaf.mod-active .bases-view')).find((x) => x.offsetParent !== null);
		if (!v) return done(null);
		v.scrollLeft = 0;
		setTimeout(() => {
			const row = v.querySelector<HTMLElement>('.bases-tbody > .bases-tr');
			const cells = row ? (Array.from(row.children) as HTMLElement[]).slice(0, 3) : [];
			const before = cells.map((c) => Math.round(c.getBoundingClientRect().left));
			v.scrollLeft = l;
			setTimeout(() => {
				const after = cells.map((c) => (c.isConnected ? Math.round(c.getBoundingClientRect().left) : -1));
				done({
					view: v.getAttribute('data-view-name'),
					scroll: Math.round(v.scrollLeft),
					frozen: row?.querySelectorAll('.bfp-frozen').length ?? -1,
					rows: v.querySelectorAll('.bases-tr.bfp-row').length,
					before,
					after,
				});
			}, 700);
		}, 300);
	}, left);
}

/** Runs the view command, waits for its modal and checks that the modal is for the expected view. */
async function openViewModal(view: string): Promise<void> {
	expect(await browser.execute(() => document.querySelectorAll('.modal-container').length)).toBe(0);
	const ran = await browser.executeObsidian(({ app }, id) => (app as unknown as { commands: { executeCommandById(c: string): boolean } }).commands.executeCommandById(`${id}:set-view`), pluginId);
	expect(ran).toBe(true);
	await browser.waitUntil(async () => browser.execute(() => document.querySelector('.modal .setting-item') !== null), { timeout: 5000, timeoutMsg: 'no view modal' });
	expect(await browser.execute(() => document.querySelector('.modal .modal-title')?.textContent ?? '')).toBe(`Frozen panes for the view ${view}`);
}

/** Finds a setting row of the open modal by its name. */
async function useModalControl(name: string, action: 'toggle' | { select: string }): Promise<boolean> {
	return browser.execute(
		(n: string, a: 'toggle' | { select: string }) => {
			const item = Array.from(document.querySelectorAll<HTMLElement>('.modal .setting-item')).find((el) => el.querySelector('.setting-item-name')?.textContent === n);
			if (!item) return false;
			if (a === 'toggle') {
				item.querySelector<HTMLElement>('.checkbox-container')?.click();
				return true;
			}
			const select = item.querySelector<HTMLSelectElement>('select');
			if (!select || select.disabled) return false;
			select.value = a.select;
			select.dispatchEvent(new Event('change'));
			return true;
		},
		name,
		action,
	);
}

async function closeModal(): Promise<void> {
	await browser.keys('Escape');
	await browser.waitUntil(async () => browser.execute(() => document.querySelectorAll('.modal-container').length === 0), { timeout: 5000, timeoutMsg: 'the view modal did not close' });
	await browser.pause(300);
}

async function viewChoices(path: string): Promise<Record<string, unknown> | null> {
	return browser.executeObsidian(({ app }, id, p) => (app as unknown as { plugins: { plugins: Record<string, PluginShape> } }).plugins.plugins[id]!.settings.files[p]?.views ?? null, pluginId, path);
}

describe(`${pluginId} choices for one view`, function () {
	before(async function () {
		await obsidianPage.openFile(BASE);
		await selectView('Wide');
		const pro = await browser.executeObsidian(
			async ({ app }, id, tokenId) => {
				const p = (app as unknown as { plugins: { plugins: Record<string, PluginShape> } }).plugins.plugins[id]!;
				p.pro.opts.http = () =>
					Promise.resolve({
						status: 200,
						json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: 'tier', monthlyPriceInCents: 500, isOneTime: false } } } } },
					});
				app.secretStorage.setSecret(tokenId, `gho_${'0'.repeat(36)}`);
				await p.pro.refreshNow();
				return p.isPro();
			},
			pluginId,
			TOKEN_ID,
		);
		expect(pro).toBe(true);
	});

	after(async function () {
		await browser.executeObsidian(
			async ({ app }, id, renamed, base) => {
				const file = app.vault.getAbstractFileByPath(renamed);
				if (file) await app.fileManager.renameFile(file, base);
				const p = (app as unknown as { plugins: { plugins: Record<string, PluginShape> } }).plugins.plugins[id]!;
				p.pro.signOut();
				p.settings.files = {};
				await p.saveSettings();
				p.refresh();
			},
			pluginId,
			RENAMED,
			BASE,
		);
	});

	it('the command modal saves 3 columns for Wide and turns Narrow off', async function () {
		await openViewModal('Wide');
		expect(await useModalControl('Frozen columns', { select: '3' })).toBe(true);
		await browser.pause(300);
		await closeModal();
		expect(await viewChoices(BASE)).toEqual({ Wide: { columns: 3 } });
		await selectView('Narrow');
		await openViewModal('Narrow');
		expect(await useModalControl('Freeze this view', 'toggle')).toBe(true);
		await browser.pause(300);
		await closeModal();
		expect(await viewChoices(BASE)).toEqual({ Wide: { columns: 3 }, Narrow: { off: true } });
	});

	it('Wide keeps 3 frozen columns after a scroll of 400 px right; Narrow has no frozen cells', async function () {
		await selectView('Wide');
		const wide = (await probe(400))!;
		expect(wide.view).toBe('Wide');
		expect(wide.scroll).toBe(400);
		expect(wide.frozen).toBe(3);
		expect(wide.after).toEqual(wide.before);

		await selectView('Narrow');
		const narrow = (await probe(400))!;
		expect(narrow.view).toBe('Narrow');
		expect(narrow.frozen).toBe(0);
		expect(narrow.rows).toBe(0);
		expect(await browser.execute(() => document.querySelectorAll('.workspace-leaf.mod-active .bases-view .bfp-frozen').length)).toBe(0);

		// Back in the same tab: the Wide choice applies again at once.
		await selectView('Wide');
		const again = (await probe(400))!;
		expect(again.frozen).toBe(3);
		expect(again.after).toEqual(again.before);
	});

	it('the view choices follow the base file when it is renamed', async function () {
		await browser.executeObsidian(
			async ({ app }, from, to) => {
				const file = app.vault.getAbstractFileByPath(from);
				if (file) await app.fileManager.renameFile(file, to);
			},
			BASE,
			RENAMED,
		);
		await browser.waitUntil(async () => (await viewChoices(RENAMED)) !== null, { timeout: 5000, timeoutMsg: 'view choices did not move' });
		expect(await viewChoices(RENAMED)).toEqual({ Wide: { columns: 3 }, Narrow: { off: true } });
		expect(await viewChoices(BASE)).toBeNull();
		await selectView('Wide');
		expect((await probe(400))!.frozen).toBe(3);
	});
});
