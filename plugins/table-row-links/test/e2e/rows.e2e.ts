import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { existsSync, readFileSync } from 'node:fs';
import { lastNotice, pluginId } from './load';

// The monorepo keeps the golden vectors in packages/spec. The public repo export copies them to tests/vectors.
const VECTORS = existsSync('tests/vectors/table-row-links.json') ? 'tests/vectors/table-row-links.json' : '../../packages/spec/vectors/table-row-links.json';

const FILE = 'Notes/My #1 Fruit.md';
const TEXT = '# Fruit\n| Fruit | Count |\n|---|---|\n| Apples %%row:abc123%% | 3 |\n| Pears %%row:def456%% | 5 |\n';
interface PluginApi {
	openRow(params: Record<string, string>): Promise<void>;
	searchVault(): Promise<void>;
	pro: { opts: { http: unknown }; refreshNow(): Promise<void>; signOut(): void };
}
async function setPro(on: boolean): Promise<void> {
	await browser.executeObsidian(async ({ app }, id, value) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, PluginApi> } }).plugins.plugins[id]!;
		if (!value) { p.pro.signOut(); return; }
		p.pro.opts.http = () => Promise.resolve({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
		app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
		await p.pro.refreshNow();
	}, pluginId, on);
}
async function openRow(file: string, row: string): Promise<void> {
	await browser.executeObsidian(async ({ app }, id, path, anchor) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, PluginApi> } }).plugins.plugins[id]!;
		await p.openRow({ file: path, row: anchor });
	}, pluginId, file, row);
}
async function state() {
	return browser.executeObsidian(({ app, obsidian }) => {
		const v = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
		return { file: v?.file?.path, line: v?.editor.getCursor().line, text: v?.editor.getValue(), mode: v?.getMode() };
	});
}
async function source(path: string, line = 0) {
	await obsidianPage.openFile(path);
	await browser.executeObsidian(async ({ app, obsidian }, n) => {
		const v = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;
		await v.leaf.setViewState({ type: 'markdown', state: { file: v.file!.path, mode: 'source', source: true } });
		v.editor.setCursor({ line: n, ch: 2 });
		v.editor.focus();
	}, line);
	await browser.waitUntil(async () => (await state()).mode === 'source', { timeout: 10000 });
}

describe('table row behavior', function () {
	before(async function () {
		await setPro(false);
		await obsidianPage.write(FILE, TEXT);
		await obsidianPage.write('Fruit.md', TEXT);
		await obsidianPage.write('Other.md', '| Task |\n|---|\n| Ship %%row:ghi789%% |\n');
	});
	after(async function () { await setPro(false); });

	it('copies a new row link once without replacing other lines', async function () {
		await obsidianPage.write('Copy.md', '# Work\n| Fruit | Count |\n|---|---|\n| Apples | 3 |\nTail');
		await source('Copy.md', 3);
		// Clipboard permission differs across CI desktops. Stub only this boundary and inspect its exact input.
		await browser.execute(() => {
			Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: (text: string) => { (window as unknown as { rowClipboard: string }).rowClipboard = text; return Promise.resolve(); } });
		});
		await browser.executeObsidianCommand(`${pluginId}:copy-row-link`);
		await browser.waitUntil(async () => (await state()).text?.includes('%%row:') ?? false, { timeout: 10000 });
		const first = await state();
		const copied = await browser.execute(() => (window as unknown as { rowClipboard: string }).rowClipboard);
		expect(copied).toMatch(/^\[Apples\]\(obsidian:\/\/table-row\?vault=.+&file=Copy.md&row=[a-z0-9]{6}\)$/);
		expect(first.text).toMatch(/^# Work\n\| Fruit \| Count \|\n\|---\|---\|\n\| Apples %%row:[a-z0-9]{6}%% \| 3 \|\nTail$/);
		await browser.executeObsidianCommand(`${pluginId}:copy-row-link`);
		expect((await state()).text).toBe(first.text);
		expect(await browser.execute(() => (window as unknown as { rowClipboard: string }).rowClipboard)).toBe(copied);
	});

	it('does not offer copy on headers, dividers, paragraphs or fenced tables', async function () {
		await obsidianPage.write('Check.md', '# Test\n| A |\n|---|\n| a |\n```\n| A |\n|---|\n| a |\n```');
		await source('Check.md');
		const result = await browser.executeObsidian(({ app, obsidian }, id) => {
			const editor = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor;
			const command = (app as unknown as { commands: { commands: Record<string, { editorCheckCallback(checking: boolean, editor: unknown, ctx: unknown): boolean }> } }).commands.commands[`${id}:copy-row-link`]!;
			return [0, 1, 2, 3, 7].map((line) => { editor.setCursor({ line, ch: 0 }); return command.editorCheckCallback(true, editor, app.workspace.getActiveViewOfType(obsidian.MarkdownView)); });
		}, pluginId);
		expect(result).toEqual([false, false, false, true, false]);
	});

	const vectors = JSON.parse(readFileSync(VECTORS, 'utf8')) as { app_cases: { name: string; file: string; row?: string; expected_line?: number; notice?: string; hidden?: string; visible?: string }[] };
	for (const c of vectors.app_cases.filter((x) => x.row)) {
		it(c.name, async function () {
			await openRow(c.file, c.row!);
			if (c.expected_line !== undefined) {
				const s = await state();
				expect(s.file).toBe(c.file); expect(s.line).toBe(c.expected_line); expect(s.mode).toBe('source');
			}
			if (c.notice) await browser.waitUntil(async () => (await lastNotice()) === c.notice, { timeout: 10000 });
		});
	}

	it('scrolls a row far down the note into the viewport', async function () {
		const text = '# Long\n' + 'Paragraph\n\n'.repeat(80) + '| A |\n|---|\n| Target %%row:jkl012%% |';
		await obsidianPage.write('Long.md', text);
		await openRow('Long.md', 'jkl012');
		expect((await state()).line).toBe(163);
		await browser.waitUntil(async () => browser.execute(() => {
			const line = Array.from(document.querySelectorAll('.workspace-leaf.mod-active .cm-line')).find((el) => el.textContent?.includes('Target'));
			const scroller = document.querySelector('.workspace-leaf.mod-active .cm-scroller');
			if (!line || !scroller) return false;
			const r = line.getBoundingClientRect(); const s = scroller.getBoundingClientRect();
			return r.bottom > s.top && r.top < s.bottom;
		}), { timeout: 10000, timeoutMsg: 'target row was not visible' });
	});

	it('reading view hides comments and shows the cell values', async function () {
		const c = vectors.app_cases.find((x) => x.hidden)!;
		await obsidianPage.openFile(c.file);
		await browser.executeObsidian(async ({ app, obsidian }) => {
			const v = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;
			await v.leaf.setViewState({ type: 'markdown', state: { file: v.file!.path, mode: 'preview' } });
		});
		await browser.waitUntil(async () => (await browser.$('.workspace-leaf.mod-active .markdown-preview-view table').getText()).includes(c.visible!), { timeout: 10000 });
		const visible = await browser.$('.workspace-leaf.mod-active .markdown-preview-view table').getText();
		expect(visible).not.toContain(c.hidden!);
		expect(visible).toContain('3');
	});

	it('local jump lists ids and line numbers and selects the row', async function () {
		await source(FILE);
		await browser.executeObsidianCommand(`${pluginId}:jump-to-row`);
		await browser.waitUntil(async () => (await browser.$('.table-row-links-modal').getText()).includes('abc123'), { timeout: 10000 });
		expect(await browser.$('.table-row-links-modal').getText()).toContain('Apples (line 4, abc123)');
		await browser.$('.table-row-links-modal .suggestion-item').click();
		await browser.waitUntil(async () => (await state()).line === 3, { timeout: 10000 });
	});

	it('gates vault search and cleanup through Sponsors and searches other notes', async function () {
		await source(FILE);
		await browser.executeObsidianCommand(`${pluginId}:jump-to-row-vault`);
		expect(await browser.$('.table-row-links-modal').isExisting()).toBe(false);
		expect(await lastNotice()).toContain('Sponsor');
		await browser.executeObsidianCommand(`${pluginId}:remove-unused-anchors`);
		expect((await state()).text?.replace(/ +/g, ' ')).toContain('| Apples %%row:abc123%% | 3 |');
		await setPro(true);
		await browser.executeObsidianCommand(`${pluginId}:jump-to-row-vault`);
		await browser.waitUntil(async () => (await browser.$('.table-row-links-modal').getText()).includes('ghi789'), { timeout: 10000 });
		await browser.$('.table-row-links-modal input').setValue('Ship');
		await browser.waitUntil(async () => (await browser.$('.table-row-links-modal .suggestion-item').getText()).includes('Other.md'), { timeout: 10000 });
		await browser.$('.table-row-links-modal .suggestion-item').click();
		await browser.waitUntil(async () => (await state()).file === 'Other.md' && (await state()).line === 2, { timeout: 10000 });
	});

	it('Pro reading link opens a table row while native blocks keep their own handler', async function () {
		await setPro(true);
		await obsidianPage.write('Links.md', '# Links\n[[Fruit#^abc123|Open Apples]]\n');
		await obsidianPage.openFile('Links.md');
		await browser.executeObsidian(async ({ app, obsidian }) => {
			const v = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;
			await v.leaf.setViewState({ type: 'markdown', state: { file: 'Links.md', mode: 'preview' } });
		});
		await browser.waitUntil(async () => browser.$('.workspace-leaf.mod-active .table-row-links-anchor').isExisting(), { timeout: 10000 });
		await browser.$('.workspace-leaf.mod-active .table-row-links-anchor').click();
		await browser.waitUntil(async () => (await state()).file === 'Fruit.md' && (await state()).line === 3, { timeout: 10000, timeoutMsg: 'row link did not navigate' }).catch(async (error) => { console.log('row link failure state', await state()); throw error; });
	});

	it('leaves a native block link with the core handler', async function () {
		await setPro(true);
		await obsidianPage.write('Native.md', '# Native block\n\nA native block. ^native\n');
		await obsidianPage.write('Native links.md', '[[Native#^native|Open native block]]\n');
		await obsidianPage.openFile('Native links.md');
		await browser.executeObsidian(async ({ app, obsidian }) => {
			const v = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;
			await v.leaf.setViewState({ type: 'markdown', state: { file: 'Native links.md', mode: 'preview' } });
		});
		const selector = '.workspace-leaf.mod-active a.internal-link';
		await browser.waitUntil(async () => (await browser.$(selector).getText()) === 'Open native block', { timeout: 10000 });
		expect(await browser.$(selector).getAttribute('class')).not.toContain('table-row-links-anchor');
		await browser.$(selector).click();
		await browser.waitUntil(async () => (await state()).file === 'Native.md', { timeout: 10000 });
	});

	it('Pro cleanup preserves references from other notes', async function () {
		await setPro(true);
		await obsidianPage.write('Keep Apples.md', `[Apples](obsidian://table-row?file=${encodeURIComponent(FILE)}&row=abc123)`);
		await obsidianPage.write('Keep.md', `[Pears](obsidian://table-row?file=${encodeURIComponent(FILE)}&row=def456)`);
		await obsidianPage.write('Links.md', `[[${FILE.split('#')[0]}]]`);
		await source(FILE);
		await browser.executeObsidianCommand(`${pluginId}:remove-unused-anchors`);
		await browser.waitUntil(async () => (await lastNotice()).startsWith('Removed'), { timeout: 10000 });
		expect((await state()).text?.replace(/ +/g, ' ')).toContain('| Apples %%row:abc123%% | 3 |'); // Apples has a wikilink; Pears has a URI.
		await obsidianPage.write('Keep Apples.md', '# No link\n');
		await browser.executeObsidianCommand(`${pluginId}:remove-unused-anchors`);
		await browser.waitUntil(async () => !(await state()).text?.includes('abc123'), { timeout: 10000 });
		expect((await state()).text).toContain('Pears %%row:def456%%');
		expect((await state()).text?.replace(/ +/g, ' ')).toContain('| Apples | 3 |');
	});
});
