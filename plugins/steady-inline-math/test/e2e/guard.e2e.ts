import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId, reloadPlugin } from './load';
async function snapshot() {
	return browser.executeObsidian(({ app, plugins, obsidian }) => {
		const p = plugins.steadyInlineMath; const v = [...p.guard.views].find((v) => p.filePath(v.state) === app.workspace.getActiveFile()?.path && v.dom.isConnected && v.dom.offsetParent !== null);
		return v ? { source: v.state.doc.toString(), clean: p.guard.cleanText(v), caret: v.state.selection.main.head, live: v.state.field(obsidian.editorLivePreviewField, false) === true, shown: v.contentDOM.textContent ?? '' } : null;
	});
}
async function waitSource(text: string) {
	await browser.waitUntil(async () => (await snapshot())?.source === text, { timeout: 10000, interval: 50, timeoutMsg: `Expected source ${text}` }); return (await snapshot())!;
}
let openCount = 0;
async function open(doc: string, caret = 0, path = 'Guard.md') {
	path = path.replace(/\.md$/, `-${++openCount}.md`);
	await browser.executeObsidian(({ plugins }) => { const p = plugins.steadyInlineMath; p.settings.enabled = false; p.guard.refresh(); p.pro!.signOut(); });
	await obsidianPage.write(path, doc); await obsidianPage.openFile(path);
	await browser.executeObsidian(async ({ app }) => { const leaf = app.workspace.getMostRecentLeaf()!; const old = leaf.getViewState(); await leaf.setViewState({ ...old, state: { ...(old.state as Record<string, unknown>), mode: 'source', source: false } }); });
	await browser.waitUntil(async () => { const s = await snapshot(); return s?.source === doc && s.live; }, { timeout: 10000, interval: 50, timeoutMsg: 'Live Preview did not open' });
	await browser.executeObsidian(({ app, plugins }, pos) => { const p = plugins.steadyInlineMath; p.settings.enabled = true; const v = [...p.guard.views].find((v) => p.filePath(v.state) === app.workspace.getActiveFile()?.path && v.dom.isConnected && v.dom.offsetParent !== null)!; v.focus(); v.dispatch({ selection: { anchor: pos } }); p.guard.refresh(); }, caret);
}
async function leave() {
	await browser.executeObsidian(({ app, plugins }) => { const p = plugins.steadyInlineMath; const v = [...p.guard.views].find((v) => p.filePath(v.state) === app.workspace.getActiveFile()?.path && v.dom.isConnected && v.dom.offsetParent !== null)!; v.dispatch({ selection: { anchor: 0 } }); });
}
async function setPro(on: boolean) {
	await browser.executeObsidian(async ({ app, plugins }, value) => {
		const p = plugins.steadyInlineMath; if (!value) { p.pro!.signOut(); return; }
		p.pro!.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
		app.secretStorage.setSecret('steady-inline-math-github-token', 'gho_' + '0'.repeat(36)); await p.pro!.refreshNow();
	}, on);
}
describe('inline math in the real editor', function () {
	it('keeps an opening space and hides owned braces', async function () {
		await open('A $x$ end', 3); const s = await waitSource('A ${}x{}$ end'); expect(s.shown).not.toContain('{}'); expect(s.caret).toBe(5);
		await browser.keys(' '); await waitSource('A ${} x{}$ end'); await leave(); await waitSource('A $ x$ end');
	});
	it('keeps a closing space', async function () { await open('A $x$ end', 4); await waitSource('A ${}x{}$ end'); await browser.keys(' '); await waitSource('A ${}x {}$ end'); await leave(); await waitSource('A $x $ end'); });
	it('keeps user braces on cursor exit', async function () { await open('A $x{}+y$ end', 3); await waitSource('A ${}x{}+y{}$ end'); expect((await snapshot())!.clean).toBe('A $x{}+y$ end'); await leave(); await waitSource('A $x{}+y$ end'); });
	it('Undo and Redo restore the space and caret', async function () {
		await open('A $x$ end', 3); await waitSource('A ${}x{}$ end'); await browser.keys(' '); await waitSource('A ${} x{}$ end');
		const mod = await browser.executeObsidian(({ obsidian }) => obsidian.Platform.isMacOS ? 'Meta' : 'Control'); await browser.keys([mod, 'z']); expect((await waitSource('A ${}x{}$ end')).caret).toBe(5);
		await browser.keys([mod, 'Shift', 'z']); expect((await waitSource('A ${} x{}$ end')).caret).toBe(6); await leave(); await waitSource('A $ x$ end');
	});
	it('skips escaped dollars, code, display math and tables', async function () { for (const doc of ['Cost \\$5', 'Code `$x$`', 'Text $$x$$', '| $x$ |', '```\n$x$\n```']) { await open(doc, Math.max(1, doc.indexOf('x'))); await waitSource(doc); } });
	it('multiple selections cause no text change', async function () {
		await open('A $x$ and $y$ end');
		await browser.executeObsidian(({ app, plugins }) => { const p = plugins.steadyInlineMath; const v = [...p.guard.views].find((v) => p.filePath(v.state) === app.workspace.getActiveFile()?.path && v.dom.isConnected && v.dom.offsetParent !== null)!; const Selection = v.state.selection.constructor as unknown as { create(ranges: unknown[]): typeof v.state.selection; cursor(pos: number): unknown }; v.dispatch({ selection: Selection.create([Selection.cursor(3), Selection.cursor(11)]) }); });
		await waitSource('A $x$ and $y$ end');
	});
	it('synthetic composition suspends source changes and resumes afterward', async function () {
		await open('A $x$ end');
		await browser.executeObsidian(({ app, plugins }) => { const p = plugins.steadyInlineMath; const v = [...p.guard.views].find((v) => p.filePath(v.state) === app.workspace.getActiveFile()?.path && v.dom.isConnected && v.dom.offsetParent !== null)!; v.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); v.dispatch({ selection: { anchor: 3 } }); v.dispatch({ changes: { from: 3, insert: '日' }, selection: { anchor: 4 }, userEvent: 'input.type.compose' }); });
		await waitSource('A $日x$ end');
		await browser.executeObsidian(({ app, plugins }) => { const p = plugins.steadyInlineMath; const v = [...p.guard.views].find((v) => p.filePath(v.state) === app.workspace.getActiveFile()?.path && v.dom.isConnected && v.dom.offsetParent !== null)!; v.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })); });
		await waitSource('A ${}日x{}$ end'); await leave(); await waitSource('A $日x$ end');
	});
	it('toggle cleans and saves its state on reload', async function () {
		await open('A $x{}+y$ end', 3); await waitSource('A ${}x{}+y{}$ end'); await browser.executeObsidianCommand(`${pluginId}:toggle-guard`); await waitSource('A $x{}+y$ end'); expect((await reloadPlugin(pluginId)).errors).toEqual([]); expect(await browser.executeObsidian(({ plugins }) => plugins.steadyInlineMath.settings.enabled)).toBe(false);
	});
	it('unload cleans owned braces and keeps user text', async function () {
		await open('A $x{}+y$ end', 3); await waitSource('A ${}x{}+y{}$ end');
		const text = await browser.executeObsidian(async ({ app, obsidian }, id) => { const editor = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor; const manager = (app as unknown as { plugins: { disablePlugin(id: string): Promise<void>; enablePlugin(id: string): Promise<boolean> } }).plugins; await manager.disablePlugin(id); const source = editor.getValue(); await manager.enablePlugin(id); return source; }, pluginId); expect(text).toBe('A $x{}+y$ end');
	});
	it('opening another note cleans the source of the previous note', async function () {
		await open('A $x{}+y$ end', 3); await waitSource('A ${}x{}+y{}$ end');
		const path = await browser.executeObsidian(({ app }) => app.workspace.getActiveFile()!.path);
		await obsidianPage.write('Other.md', 'A different note.'); await obsidianPage.openFile('Other.md');
		await browser.waitUntil(async () => (await obsidianPage.read(path)) === 'A $x{}+y$ end', { timeout: 10000, interval: 50, timeoutMsg: 'The previous note kept temporary braces' });
	});
	it('closing the tab saves the note without temporary braces', async function () {
		await open('A $x$ end', 3); await waitSource('A ${}x{}$ end'); await browser.keys(' '); await waitSource('A ${} x{}$ end');
		const path = await browser.executeObsidian(({ app }) => { const file = app.workspace.getActiveFile()!.path; app.workspace.getMostRecentLeaf()!.detach(); return file; });
		await browser.waitUntil(async () => (await obsidianPage.read(path)) === 'A $ x$ end', { timeout: 10000, interval: 50, timeoutMsg: 'The closed note kept temporary braces' });
	});
	it('Source mode does not add guards', async function () {
		await open('A $x$ end'); await browser.executeObsidianCommand('editor:toggle-source');
		await browser.waitUntil(async () => (await snapshot())?.live === false, { timeout: 10000, interval: 50, timeoutMsg: 'Source mode did not start' });
		await browser.executeObsidian(({ app, plugins }) => { const p = plugins.steadyInlineMath; const v = [...p.guard.views].find((v) => p.filePath(v.state) === app.workspace.getActiveFile()?.path && v.dom.isConnected && v.dom.offsetParent !== null)!; v.dispatch({ selection: { anchor: 3 } }); });
		await waitSource('A $x$ end'); expect((await snapshot())!.live).toBe(false);

	});
	it('folder rules are saved and need Pro', async function () {
		await browser.executeObsidian(async ({ app }) => { if (!app.vault.getAbstractFileByPath('Archive')) await app.vault.createFolder('Archive'); }); await open('A $x$ end', 0, 'Archive/Guard.md');
		await browser.executeObsidian(async ({ plugins }) => { const p = plugins.steadyInlineMath; p.settings.folderRules = '-Archive'; await p.saveSettings(); }); await setPro(true);
		await browser.executeObsidian(({ app, plugins }) => { const p = plugins.steadyInlineMath; const v = [...p.guard.views].find((v) => p.filePath(v.state) === app.workspace.getActiveFile()?.path && v.dom.isConnected && v.dom.offsetParent !== null)!; v.dispatch({ selection: { anchor: 3 } }); }); await waitSource('A $x$ end'); expect((await reloadPlugin(pluginId)).errors).toEqual([]); expect(await browser.executeObsidian(({ plugins }) => plugins.steadyInlineMath.settings.folderRules)).toBe('-Archive'); await setPro(false); await waitSource('A ${}x{}$ end'); await leave();
	});
	it('the local equation panel needs Pro and clears on sign out', async function () {
		await open('A $x$ end\n\nB $y+z$ end'); expect(await browser.executeObsidian(({ plugins }) => plugins.steadyInlineMath.showEquations())).toBe(false); await setPro(true); expect(await browser.executeObsidian(({ plugins }) => plugins.steadyInlineMath.showEquations())).toBe(true);
		await browser.waitUntil(async () => (await browser.execute(() => [...document.querySelectorAll('.steady-inline-math-equation code')].map((n) => n.textContent).join('|'))) === 'x|y+z', { timeout: 10000, interval: 50, timeoutMsg: 'The panel did not show the note equations' }); await setPro(false); expect(await browser.execute(() => document.querySelectorAll('.steady-inline-math-equation').length)).toBe(0);
	});
});
