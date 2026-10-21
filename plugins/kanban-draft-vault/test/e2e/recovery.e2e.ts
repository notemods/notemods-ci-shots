import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import type KanbanDraftVaultPlugin from '../../src/main';
import type { Draft } from '../../src/model';
import { pluginId, reloadPlugin } from './load';

declare module 'wdio-obsidian-service' { interface InstalledPlugins { kanbanDraftVault: KanbanDraftVaultPlugin } }
const A = '---\nkanban-plugin: board\n---\n\n## Todo\n\n- [ ] Plan the next week\n\n## Todo\n\n- [ ] Review the plan\n';
const B = '---\nkanban-plugin: board\n---\n\n## Inbox\n\n- [ ] Review the budget\n';
async function openFile(path: string): Promise<void> {
	await browser.executeObsidian(async ({ app, obsidian }, owner) => {
		const file = app.vault.getAbstractFileByPath(owner);
		if (!(file instanceof obsidian.TFile)) throw new Error('Fixture file missing');
		const leaf = app.workspace.getLeaf(false);
		await leaf.openFile(file); app.workspace.setActiveLeaf(leaf, { focus: true });
	}, path);
}
async function drafts(): Promise<Draft[]> { return browser.executeObsidian(({ plugins }) => plugins.kanbanDraftVault.settings.drafts); }
async function saved(): Promise<void> {
	expect(await browser.executeObsidian(async ({ plugins }) => plugins.kanbanDraftVault.saves.flush())).toBe(true);
}
async function board(path = 'Board A.md'): Promise<void> {
	await openFile(path);
	await browser.waitUntil(async () => browser.executeObsidian(({ app }, owner) => app.workspace.getActiveFile()?.path === owner && document.querySelector('.kanban-plugin__new-item-button') !== null, path), { timeout: 15000, timeoutMsg: 'Kanban board did not render' });
}
async function newCard(text: string, lane = 0): Promise<void> {
	await browser.executeObsidian((_, index) => {
		const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.kanban-plugin__new-item-button')).filter((e) => e.offsetParent !== null);
		if (!buttons[index]) throw new Error('New-card button missing'); buttons[index].click();
	}, lane);
	const editor = browser.$('.kanban-plugin__item-form .cm-content');
	await editor.waitForExist({ timeout: 15000 });
	await browser.executeObsidian(() => document.querySelector<HTMLElement>('.kanban-plugin__item-form .cm-content')!.focus());
	await browser.waitUntil(async () => browser.executeObsidian(({ app }) => app.workspace.activeEditor?.file?.path === app.workspace.getActiveFile()?.path), { timeout: 5000 });
	await setText(text);
}
async function setText(text: string): Promise<void> {
	await browser.executeObsidian(({ require }, value) => {
		const { EditorView } = require('@codemirror/view') as typeof import('@codemirror/view');
		const dom = document.querySelector<HTMLElement>('.kanban-plugin__item-form .cm-editor, .kanban-plugin__item .cm-editor');
		const cm = dom && EditorView.findFromDOM(dom);
		if (!cm) throw new Error('Kanban editor missing');
		cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: value } });
	}, text);
}
async function outside(): Promise<void> {
	await browser.executeObsidian(() => {
		const header = document.querySelector('.kanban-plugin__lane-title-text');
		if (!header) throw new Error('Lane header missing'); header.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
	});
	await browser.waitUntil(async () => !(await browser.$('.kanban-plugin__item-form').isExisting()), { timeout: 5000 });
}
async function recovery(): Promise<void> {
	await browser.executeObsidianCommand(`${pluginId}:recover-drafts`);
	await browser.$('.kanban-draft-vault-modal').waitForExist({ timeout: 5000 });
}
async function blockNextSave(): Promise<void> {
	await browser.executeObsidian(({ plugins }) => {
		const p = plugins.kanbanDraftVault as KanbanDraftVaultPlugin & { testSave?: { blocked: boolean; release: () => void; restore: () => void } };
		const original = p.saveData;
		let first = true;
		const gate = { blocked: false, release: () => {}, restore: () => { p.saveData = original; delete p.testSave; } };
		p.testSave = gate;
		p.saveData = async (snapshot: unknown) => {
			if (first) {
				first = false; gate.blocked = true;
				await new Promise<void>((resolve) => { gate.release = resolve; });
				gate.blocked = false;
			}
			await original.call(p, snapshot);
		};
	});
}
async function waitForBlockedSave(): Promise<void> {
	await browser.waitUntil(async () => browser.executeObsidian(({ plugins }) => {
		const p = plugins.kanbanDraftVault as KanbanDraftVaultPlugin & { testSave?: { blocked: boolean } };
		return p.testSave?.blocked === true;
	}), { timeout: 5000, timeoutMsg: 'Controlled local write did not start' });
}
async function releaseSave(): Promise<void> {
	await browser.executeObsidian(async ({ plugins }) => {
		const p = plugins.kanbanDraftVault as KanbanDraftVaultPlugin & { testSave?: { release: () => void; restore: () => void } };
		p.testSave?.release(); await p.saves.flush(); p.testSave?.restore();
	});
}
async function setPro(): Promise<void> {
	await browser.executeObsidian(async ({ app, plugins }) => {
		const pro = plugins.kanbanDraftVault.pro!;
		const reply = { status: 200, json: { data: { viewer: { login: 'test-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } };
		(pro as unknown as { opts: { http: unknown } }).opts.http = () => Promise.resolve(reply);
		app.secretStorage.setSecret('kanban-draft-vault-github-token', 'gho_' + '0'.repeat(36)); await pro.refreshNow();
	});
}

describe('Kanban 2.0.51 draft integration', function () {
	afterEach(async function () { await releaseSave(); });
	beforeEach(async function () {
		await browser.keys('Escape');
		await browser.waitUntil(async () => !(await browser.$('.kanban-draft-vault-modal').isExisting()), { timeout: 5000 });
		await openFile('Welcome.md');
		await obsidianPage.write('Board A.md', A); await obsidianPage.write('Board B.md', B);
		await browser.executeObsidian(async ({ plugins }) => {
			const p = plugins.kanbanDraftVault;
			p.pro?.signOut(); await p.saves.flush(); p.settings = { drafts: [], limits: {} }; await p.saveSettings();
		});
	});
	it('captures outside cancellation with the owner board and lane label', async function () {
		await board(); await newCard('Call Ana'); await outside(); await saved(); await recovery();
		const records = await drafts(); expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({ board: 'Board A.md', lane: 'Todo', text: 'Call Ana' });
		expect(await browser.$('.kanban-draft-vault-text').getValue()).toBe('Call Ana');
	});
	it('keeps two lines after Escape', async function () {
		await board(); await newCard('Line one\nLine two'); await browser.keys('Escape'); await saved();
		expect((await drafts())[0]?.text).toBe('Line one\nLine two');
	});
	it('retains a saved draft after reload without changing the board file', async function () {
		await board(); await newCard('Call Ana'); await outside(); await saved();
		expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] });
		expect((await drafts())[0]?.text).toBe('Call Ana'); expect(await obsidianPage.read('Board A.md')).toBe(A);
	});
	it('keeps Board A and Board B owners after a change of active note', async function () {
		await board(); await blockNextSave(); await newCard('Draft A'); await waitForBlockedSave(); await outside();
		await board('Board B.md'); await newCard('Draft B'); await openFile('Welcome.md'); await releaseSave(); await saved();
		expect((await drafts()).map((d) => [d.board, d.text]).sort()).toEqual([['Board A.md', 'Draft A'], ['Board B.md', 'Draft B']]);
	});
	it('keeps separate records for two lanes with identical titles', async function () {
		await board(); await newCard('First Todo'); await outside(); await newCard('Second Todo', 1); await outside(); await saved();
		const records = await drafts(); expect(records).toHaveLength(2); expect(new Set(records.map((d) => d.id)).size).toBe(2);
		expect(records.map((d) => d.lane)).toEqual(['Todo', 'Todo']);
	});
	it('retains a submitted draft but does not insert a second card', async function () {
		await board(); await newCard('A submitted card'); await browser.keys('Enter'); await saved();
		await browser.waitUntil(async () => (await obsidianPage.read('Board A.md')).includes('- [ ] A submitted card'), { timeout: 15000 });
		await recovery(); expect((await obsidianPage.read('Board A.md')).match(/- \[ \] A submitted card/g)).toHaveLength(1);
		expect((await drafts())[0]?.text).toBe('A submitted card');
	});
	it('keeps nonempty text when the editor is cleared', async function () {
		await board(); await newCard('Keep this text'); await setText(''); await outside(); await saved();
		expect((await drafts())[0]?.text).toBe('Keep this text');
	});
	it('provides selected complete text when clipboard access is denied', async function () {
		await board(); await newCard('Call Ana\nAsk about café ☕'); await outside(); await saved(); await recovery();
		await browser.executeObsidian(() => {
			const clipboard = navigator.clipboard; const original = clipboard.writeText;
			clipboard.writeText = async () => { throw new Error('denied'); };
			(document.querySelector('.kanban-draft-vault-draft button') as HTMLButtonElement).click();
			queueMicrotask(() => { clipboard.writeText = original; });
		});
		await browser.waitUntil(async () => browser.executeObsidian(() => {
			const field = document.querySelector<HTMLTextAreaElement>('.kanban-draft-vault-text');
			return field?.selectionStart === 0 && field.selectionEnd === field.value.length;
		}), { timeout: 5000 });
		expect(await browser.$('.kanban-draft-vault-text').getValue()).toBe('Call Ana\nAsk about café ☕'); expect(await drafts()).toHaveLength(1);
	});
	it('persists dismissal and excludes normal Markdown note text', async function () {
		await board(); await newCard('Dismiss this'); await outside(); await saved(); await recovery();
		await browser.$('.kanban-draft-vault-draft button[aria-label^="Dismiss"]').click(); await saved();
		await reloadPlugin(pluginId); await openFile('Welcome.md');
		await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.setValue('Normal note text'));
		await saved(); expect(await drafts()).toEqual([]);
	});
	it('saves the newest complete text after quick edits and outside cancellation', async function () {
		await board(); await blockNextSave(); await newCard('C'); await waitForBlockedSave();
		await browser.executeObsidian(({ app }) => {
			const editor = app.workspace.activeEditor!.editor!;
			editor.setValue('Call'); editor.setValue('Call Ana'); editor.setValue('Call Ana\nAsk about the plan');
		});
		await outside(); await releaseSave(); await saved(); expect((await drafts())[0]?.text).toBe('Call Ana\nAsk about the plan');
		expect(await browser.executeObsidian(async ({ plugins }) => (await plugins.kanbanDraftVault.loadData()).drafts[0].text)).toBe('Call Ana\nAsk about the plan');
	});
	it('keeps existing-card edits out of draft recovery', async function () {
		await board(); await browser.$('.kanban-plugin__item-title').doubleClick();
		const existingEditor = browser.$('.kanban-plugin__item .cm-content');
		await existingEditor.waitForExist({ timeout: 5000 }); await existingEditor.click();
		await setText('Edit an existing card'); await saved(); expect(await drafts()).toEqual([]);
	});
	it('gates search, versions, and retention through the Sponsors state', async function () {
		await board(); await newCard('Call Ana'); await outside(); await saved(); await recovery();
		expect(await browser.$('input[aria-label="Search drafts"]').isEnabled()).toBe(false);
		expect(await browser.executeObsidian(async ({ plugins }) => plugins.kanbanDraftVault.setBoardLimit('Board A.md', { drafts: 1 }))).toBe(false);
		await browser.keys('Escape');
		await browser.waitUntil(async () => !(await browser.$('.kanban-draft-vault-modal').isExisting()), { timeout: 5000 });
		await setPro(); await newCard('Draft one'); await setText('Draft one revised'); await outside(); await saved(); await recovery();
		expect(await browser.$('.kanban-draft-vault-versions summary').isExisting()).toBe(true);
		const search = browser.$('input[aria-label="Search drafts"]'); expect(await search.isEnabled()).toBe(true); await search.setValue('revised');
		expect(await browser.$$('.kanban-draft-vault-draft')).toHaveLength(1);
		expect(await browser.executeObsidian(async ({ plugins }) => plugins.kanbanDraftVault.setBoardLimit('Board A.md', { drafts: 1, days: 30, versions: 2 }))).toBe(true);
		expect(await drafts()).toHaveLength(1);
	});
});
