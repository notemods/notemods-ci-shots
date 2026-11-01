import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { lastNotice, pluginId } from './load';
import { captureErrors, clickLinkBack, clickMode, openWithPane, pane, takeErrors, waitPane } from './pane';

const TECH = 'Tech features.md';
const names = (a: string[]): string => a.join(', ');

/** Adds text at the end of the note in its open editor, as typing does. Obsidian saves the note about 2 seconds later. */
async function typeAtEnd(path: string, text: string): Promise<void> {
	await browser.executeObsidian(({ app, obsidian }, p, t) => {
		const view = app.workspace.getLeavesOfType('markdown').map((l) => l.view).find((v) => v instanceof obsidian.MarkdownView && v.file?.path === p) as InstanceType<typeof obsidian.MarkdownView> | undefined;
		if (!view) throw new Error(`no editor for ${p}`);
		const ed = view.editor;
		const last = ed.lastLine();
		ed.replaceRange(t, { line: last, ch: ed.getLine(last).length });
	}, path, text);
}

describe('One-way and Paired lists (post 1 and post 3 of topic 786)', function () {
	beforeEach(async function () {
		await obsidianPage.resetVault();
		await captureErrors();
		await takeErrors();
	});

	afterEach(async function () {
		expect(await takeErrors()).toEqual([]);
	});

	it('E1 E5 lists notes 1, 3 and 5 as one-way and notes 2 and 4 as paired, for alias, heading, embed, Markdown and self links', async function () {
		// The plugin adds its pane to the right sidebar one time after the first install.
		const added = await browser.executeObsidian(({ app }, id) => app.workspace.getLeavesOfType(id).length, pluginId);
		expect(added).toBe(1);
		await openWithPane(TECH);
		const s = await waitPane((p) => p.oneWay === 3 && p.paired === 2, 'counts 3 and 2');
		expect(s.note).toBe('Tech features');
		expect(s.mode).toBe('one-way');
		// Note 1 plain link, Note 3 two heading links, Note 5 a Markdown link. Unrelated and the self link are not listed.
		expect(names(s.rows)).toBe('Note 1, Note 3, Note 5');
		expect(s.counts).toEqual(['1', '2', '1']);
	});

	it('E2 the Paired button shows notes 2 and 4, and One-way shows the first list again', async function () {
		await openWithPane(TECH);
		await clickMode('paired');
		// Note 2 links by alias and is linked back. Note 4 embeds a section and the note embeds Note 4.
		let s = await waitPane((p) => p.mode === 'paired', 'paired list');
		expect(names(s.rows)).toBe('Note 2, Note 4');
		await clickMode('one-way');
		s = await waitPane((p) => p.mode === 'one-way', 'one-way list');
		expect(names(s.rows)).toBe('Note 1, Note 3, Note 5');
	});

	it('E3 a link typed in the current note moves the row to Paired, and removing it moves it back', async function () {
		await openWithPane(TECH);
		const start = Date.now();
		await typeAtEnd(TECH, '\nSee [[Note 1]].\n');
		let s = await waitPane((p) => p.oneWay === 2 && p.paired === 3, 'Note 1 paired after the edit', 15_000);
		console.info(`edit to pane update: ${Date.now() - start} ms (includes the save delay of Obsidian)`);
		expect(names(s.rows)).toBe('Note 3, Note 5');
		await browser.executeObsidian(async ({ app }, p) => {
			const f = app.vault.getFileByPath(p)!;
			await app.vault.process(f, (t) => t.replace('\nSee [[Note 1]].\n', ''));
		}, TECH);
		s = await waitPane((p) => p.oneWay === 3 && p.paired === 2, 'Note 1 one-way again', 15_000);
		expect(names(s.rows)).toBe('Note 1, Note 3, Note 5');
	});

	it('E4 a renamed source shows its new name, a renamed paired note stays paired, and a deleted source goes', async function () {
		await openWithPane(TECH);
		await browser.executeObsidian(async ({ app }) => {
			(app.vault as unknown as { setConfig(k: string, v: unknown): void }).setConfig('alwaysUpdateLinks', true);
			if (!app.vault.getFolderByPath('Moved')) await app.vault.createFolder('Moved');
			await app.fileManager.renameFile(app.vault.getFileByPath('Note 5.md')!, 'Moved/Note 5 renamed.md');
		});
		let s = await waitPane((p) => p.rows.includes('Note 5 renamed'), 'renamed row');
		expect(names(s.rows)).toBe('Note 1, Note 3, Note 5 renamed');
		await browser.executeObsidian(async ({ app }) => {
			await app.fileManager.renameFile(app.vault.getFileByPath('Note 2.md')!, 'Note 2b.md');
		});
		await clickMode('paired');
		s = await waitPane((p) => p.mode === 'paired' && p.rows.includes('Note 2b'), 'renamed paired row');
		expect(names(s.rows)).toBe('Note 2b, Note 4');
		await clickMode('one-way');
		await browser.executeObsidian(async ({ app }) => {
			await app.vault.delete(app.vault.getFileByPath('Note 3.md')!);
		});
		s = await waitPane((p) => p.mode === 'one-way' && p.oneWay === 2, 'deleted row');
		expect(names(s.rows)).toBe('Note 1, Note 5 renamed');
	});

	it('E8 a free user who selects Link back gets the Pro notice, and the note does not change', async function () {
		await openWithPane(TECH);
		const before = await obsidianPage.read(TECH);
		await clickLinkBack('Note 1');
		await browser.waitUntil(async () => (await lastNotice()).includes('Link back is a Pro feature.'), { timeout: 5000 });
		await browser.pause(500);
		expect(await obsidianPage.read(TECH)).toBe(before);
		expect((await pane())!.oneWay).toBe(3);
	});

	it('E8 Pro: Link back adds the link at the end of the open note, and the row moves to Paired', async function () {
		await browser.executeObsidian(async ({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, { pro: unknown }> } }).plugins.plugins[id]!;
			const manager = p.pro as { opts: { http: unknown }; refreshNow(): Promise<unknown>; isPro(): boolean };
			manager.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'fixture-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
			(app as unknown as { secretStorage: { setSecret(k: string, v: string): void } }).secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
			await manager.refreshNow();
			if (!manager.isPro()) throw new Error('Pro did not turn on');
		}, pluginId);
		await openWithPane(TECH);
		await clickLinkBack('Note 5');
		const s = await waitPane((p) => p.oneWay === 2 && p.paired === 3, 'Note 5 paired after Link back', 15_000);
		expect(names(s.rows)).toBe('Note 1, Note 3');
		await browser.pause(2500);
		expect(await obsidianPage.read(TECH)).toMatch(/\n- \[\[Note 5\]\]\n$/);
		await browser.executeObsidian(({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, { pro: { signOut(): void } }> } }).plugins.plugins[id]!;
			p.pro.signOut();
		}, pluginId);
	});

	it('E7 disabling the plugin with the pane open logs no error, later events do nothing, and enabling it works again', async function () {
		await openWithPane(TECH);
		await browser.executeObsidian(async ({ app }, id) => {
			await (app as unknown as { plugins: { disablePlugin(id: string): Promise<void> } }).plugins.disablePlugin(id);
		}, pluginId);
		// Events after unload: a change, a rename and a delete. The old view must not react.
		await browser.executeObsidian(async ({ app }) => {
			await app.vault.process(app.vault.getFileByPath('Note 1.md')!, (t) => t + '\nMore [[Tech features]].\n');
			await app.fileManager.renameFile(app.vault.getFileByPath('Unrelated.md')!, 'Unrelated 2.md');
		});
		try {
			await browser.pause(1500);
			expect(await pane()).toBeNull();
			expect(await browser.executeObsidian(() => document.querySelectorAll('.owb-view .owb-row').length)).toBe(0);
		} finally {
			await browser.executeObsidian(async ({ app }, id) => {
				await (app as unknown as { plugins: { enablePlugin(id: string): Promise<boolean> } }).plugins.enablePlugin(id);
			}, pluginId);
		}
		const s = await openWithPane(TECH);
		const again = await waitPane((p) => p.oneWay === 3, 'lists after enable');
		expect(s.note).toBe('Tech features');
		expect(again.counts).toEqual(['2', '2', '1']);
	});

	it('E10 with no backlinks the pane names the empty list', async function () {
		await openWithPane('Unrelated.md');
		const s = await waitPane((p) => p.note === 'Unrelated', 'pane for Unrelated');
		expect(s.oneWay).toBe(0);
		expect(s.empty).toContain('No one-way backlinks');
	});
});
