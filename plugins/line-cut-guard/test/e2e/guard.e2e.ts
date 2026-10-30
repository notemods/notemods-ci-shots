import { browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId } from './load';

// Real-app checks for the acceptance criteria of SPEC.md (lanes/NEW), on minAppVersion, on the latest app and on the
// latest app in mobile emulation (wdio.conf.mts). Keys are real key events (browser.keys), so the browser fires real,
// trusted cut and copy events. CI runs on Linux: the modifier is Ctrl.
const NOTE = [
	'# Guard test', // 0
	'', // 1
	'First line of text.', // 2
	'Second line of text.', // 3
	'Third line of text.', // 4
	'', // 5
	'| Name | Role |', // 6
	'|---|---|', // 7
	'| Ana | Lead |', // 8
	'', // 9
	'Last line.', // 10
].join('\n');
const PATH = 'Guard.md';
const ACTIVE = '.workspace-leaf.mod-active';
const SENTINEL = 'clipboard before the test';

type Mode = 'block' | 'allow' | 'twice';

interface State {
	text: string;
	line: number;
	ch: number;
	clipboard: string;
	notices: string[];
	focus: string;
}

/** Note text, cursor, clipboard, all notices seen since the last reset, and the focused element. */
async function state(): Promise<State> {
	return browser.executeObsidian(async ({ app }) => {
		const editor = app.workspace.activeEditor?.editor;
		const cur = editor?.getCursor() ?? { line: -1, ch: -1 };
		const file = app.workspace.getActiveFile();
		const text = editor ? editor.getValue() : file ? await app.vault.cachedRead(file) : '';
		let clipboard = '';
		try {
			clipboard = await navigator.clipboard.readText();
		} catch (e) {
			clipboard = `<read failed: ${String(e)}>`;
		}
		const a = document.activeElement;
		return { text, line: cur.line, ch: cur.ch, clipboard, notices: [...((window as unknown as { lcgNotices?: string[] }).lcgNotices ?? [])], focus: a ? `${a.tagName}.${a.className}`.slice(0, 80) : 'none' };
	});
}

/** Waits until check(state) is true. The error shows the last state. */
async function waitState(check: (s: State) => boolean, what: string, timeout = 4000): Promise<State> {
	let last: State | null = null;
	await browser.waitUntil(async () => check((last = await state())), { timeout, interval: 100 }).catch(() => {
		throw new Error(`${what}: ${JSON.stringify(last)}`);
	});
	return last!;
}

async function setOptions(cut: Mode, copy: Mode, notice = true): Promise<void> {
	await browser.executeObsidian(async ({ app }, id, c, p, n) => {
		const plugin = (app as unknown as { plugins: { plugins: Record<string, { settings: { cut: string; copy: string; notice: boolean }; saveSettings(): Promise<void>; applySettings(): void }> } }).plugins.plugins[id]!;
		plugin.settings.cut = c;
		plugin.settings.copy = p;
		plugin.settings.notice = n;
		await plugin.saveSettings();
		plugin.applySettings();
	}, pluginId, cut, copy, notice);
}

/** Brings the app window to the front, so the editor can have the focus. */
async function focusWindow(): Promise<void> {
	await browser.execute(() => {
		try {
			const req = (window as unknown as { require: (m: string) => { app?: { focus(o?: unknown): void }; getCurrentWindow(): { focus(): void; show(): void } } }).require;
			const remote = req('@electron/remote');
			remote.app?.focus({ steal: true });
			remote.getCurrentWindow().show();
			remote.getCurrentWindow().focus();
		} catch {
			window.focus();
		}
	});
	await browser.waitUntil(async () => browser.execute(() => document.hasFocus()), { timeout: 5000, interval: 50, timeoutMsg: 'the app window has no focus' });
}

async function setMode(mode: 'source' | 'preview', source: boolean): Promise<void> {
	await browser.executeObsidian(
		async ({ app }, m, s) => {
			const leaf = app.workspace.getMostRecentLeaf();
			if (!leaf) return;
			const st = leaf.getViewState();
			await leaf.setViewState({ ...st, state: { ...st.state, mode: m, source: s } });
		},
		mode,
		source,
	);
}

/** Writes the note, opens it in the mode, clicks the first line (a real click gives the focus), puts the clipboard sentinel and clears the notice log. */
async function openNote(mode: 'live' | 'source' = 'live', text = NOTE): Promise<void> {
	// Save and close the note of the last test first. Else its autosave can write the old text over the new file.
	await browser.executeObsidian(async ({ app }) => {
		for (const leaf of app.workspace.getLeavesOfType('markdown')) {
			await (leaf.view as unknown as { save(): Promise<void> }).save();
			leaf.detach();
		}
	});
	await obsidianPage.write(PATH, text);
	await browser.waitUntil(async () => browser.executeObsidian(async ({ app }, p, t) => {
		const f = app.vault.getFileByPath(p);
		return !!f && (await app.vault.cachedRead(f)) === t;
	}, PATH, text), { timeout: 10000, interval: 50, timeoutMsg: `${PATH} was not written` });
	await obsidianPage.openFile(PATH);
	await setMode('source', mode === 'source');
	await focusWindow();
	await browser.$(`${ACTIVE} .markdown-source-view .cm-content > .cm-line`).click();
	await browser.executeObsidian(async ({ app }, t) => {
		app.workspace.activeEditor?.editor?.setValue(t);
		document.querySelectorAll('.notice').forEach((n) => n.remove());
		(window as unknown as { lcgNotices: string[] }).lcgNotices = [];
	}, text);
	await setClipboard(SENTINEL);
}

async function setClipboard(text: string): Promise<void> {
	await browser.execute(async (t) => navigator.clipboard.writeText(t), text);
	await waitState((s) => s.clipboard === text, 'the clipboard sentinel was not written');
}

/** Puts the cursor (or a selection) in the focused editor. The editor has the focus from the real click in openNote. */
async function select(line: number, ch: number, toLine = line, toCh = ch): Promise<void> {
	await browser.executeObsidian(({ app }, a, b, c, d) => {
		app.workspace.activeEditor?.editor?.setSelection({ line: a, ch: b }, { line: c, ch: d });
	}, line, ch, toLine, toCh);
}

const cutKeys = async () => browser.keys([Key.Ctrl, 'x']);
const copyKeys = async () => browser.keys([Key.Ctrl, 'c']);
const pasteKeys = async () => browser.keys([Key.Ctrl, 'v']);

/** Lets a cut, copy or notice settle. */
const settle = async (ms = 300) => browser.pause(ms);

describe('Line Cut Guard', function () {
	before(async function () {
		// Keep the text of each notice (a notice can close before the test reads it).
		await browser.execute(() => {
			const w = window as unknown as { lcgNotices?: string[] };
			w.lcgNotices = [];
			new MutationObserver((list) => {
				for (const m of list) for (const n of Array.from(m.addedNodes)) if (n instanceof HTMLElement && n.classList.contains('notice')) w.lcgNotices!.push(n.textContent ?? '');
			}).observe(document.body, { childList: true, subtree: true });
		});
	});

	afterEach(async function () {
		await setOptions('block', 'allow', true);
	});

	it('A1 Ctrl+X with only a cursor in Live Preview keeps the note and the clipboard and shows the notice', async function () {
		await setOptions('block', 'allow');
		await openNote('live');
		await select(3, 5);
		await cutKeys();
		await settle();
		const s = await waitState((x) => x.notices.length > 0, 'no notice after Ctrl+X');
		expect(s.text).toBe(NOTE);
		expect(s.clipboard).toBe(SENTINEL);
		expect(s.notices).toEqual(['Nothing is selected, so Ctrl+X did not cut the line.']);
		expect([s.line, s.ch]).toEqual([3, 5]);
	});

	it('A1 Ctrl+X with only a cursor in Source mode keeps the note and the clipboard', async function () {
		await setOptions('block', 'allow');
		await openNote('source');
		await select(4, 0);
		await cutKeys();
		await settle();
		const s = await state();
		expect(s.text).toBe(NOTE);
		expect(s.clipboard).toBe(SENTINEL);
	});

	it('A6 Ctrl+X with two cursors and no selection keeps the note', async function () {
		await setOptions('block', 'allow');
		await openNote('live');
		await browser.executeObsidian(({ app }) => {
			app.workspace.activeEditor?.editor?.setSelections([{ anchor: { line: 2, ch: 1 } }, { anchor: { line: 4, ch: 1 } }]);
		});
		await cutKeys();
		await settle();
		const s = await state();
		expect(s.text).toBe(NOTE);
		expect(s.clipboard).toBe(SENTINEL);
	});

	it('A2 Ctrl+X with a selection cuts only the selection', async function () {
		await setOptions('block', 'allow');
		await openNote('live');
		await select(3, 0, 3, 7);
		await cutKeys();
		const s = await waitState((x) => x.clipboard === 'Second ', 'the selection was not cut');
		expect(s.text).toBe(NOTE.replace('Second line of text.', 'line of text.'));
		expect(s.notices).toEqual([]);
	});

	it('A3 with "Cuts the line", Ctrl+X cuts the line as Obsidian does, and Ctrl+V puts it back as a line (positive control)', async function () {
		await setOptions('allow', 'allow');
		await openNote('live');
		await select(3, 5);
		await cutKeys();
		const s = await waitState((x) => x.clipboard === 'Second line of text.', 'Obsidian did not cut the line');
		expect(s.text).toBe(NOTE.replace('Second line of text.\n', ''));
		expect(s.notices).toEqual([]);
		// The cursor is now on "Third line"; a line paste goes above it, as a whole line.
		await select(3, 4);
		await pasteKeys();
		const after = await waitState((x) => x.text !== s.text, 'Ctrl+V did nothing');
		expect(after.text).toBe(NOTE);
	});

	it('A4 copy "Does nothing": Ctrl+C with only a cursor keeps the clipboard, a selection is copied', async function () {
		await setOptions('block', 'block');
		await openNote('live');
		await select(2, 3);
		await copyKeys();
		await settle();
		const s = await state();
		expect(s.clipboard).toBe(SENTINEL);
		expect(s.notices).toEqual(['Nothing is selected, so Ctrl+C did not copy the line. Your clipboard did not change.']);
		await select(2, 0, 2, 5);
		await copyKeys();
		await waitState((x) => x.clipboard === 'First', 'the selection was not copied');
	});

	it('A4 copy default: Ctrl+C with only a cursor copies the line as Obsidian does (positive control)', async function () {
		await setOptions('block', 'allow');
		await openNote('live');
		await select(2, 3);
		await copyKeys();
		const s = await waitState((x) => x.clipboard === 'First line of text.', 'Obsidian did not copy the line');
		expect(s.text).toBe(NOTE);
	});

	it('A5 the command "Cut selection or line" cuts the line while Ctrl+X is guarded, and Ctrl+V puts it back as a line', async function () {
		await setOptions('block', 'allow');
		await openNote('live');
		await select(3, 5);
		await browser.executeObsidian(({ app }, id) => {
			(app as unknown as { commands: { executeCommandById(id: string): boolean } }).commands.executeCommandById(`${id}:cut-selection-or-line`);
		}, pluginId);
		const s = await waitState((x) => x.clipboard === 'Second line of text.', 'the command did not cut the line');
		expect(s.text).toBe(NOTE.replace('Second line of text.\n', ''));
		await select(3, 4);
		await pasteKeys();
		const after = await waitState((x) => x.text !== s.text, 'Ctrl+V did nothing after the command');
		expect(after.text).toBe(NOTE);
	});

	it('A5 the command "Copy selection or line" copies the line and keeps the note', async function () {
		await setOptions('block', 'block');
		await openNote('live');
		await select(4, 2);
		await browser.executeObsidian(({ app }, id) => {
			(app as unknown as { commands: { executeCommandById(id: string): boolean } }).commands.executeCommandById(`${id}:copy-selection-or-line`);
		}, pluginId);
		const s = await waitState((x) => x.clipboard === 'Third line of text.', 'the command did not copy the line');
		expect(s.text).toBe(NOTE);
	});

	it('A6 a table cell in Live Preview: Ctrl+X with only a cursor keeps the cell; with "Cuts the line" Obsidian empties it (positive control)', async function () {
		await setOptions('block', 'allow');
		await openNote('live');
		await select(0, 0);
		const td = browser.$(`//div[contains(@class,"workspace-leaf") and contains(@class,"mod-active")]//div[contains(@class,"cm-table-widget")]//td[contains(normalize-space(.),"Ana")]`);
		await td.waitForDisplayed({ timeout: 5000 });
		await td.click();
		await browser.waitUntil(async () => browser.execute(() => !!document.activeElement?.closest('.cm-table-widget')), { timeout: 3000, timeoutMsg: 'the cell editor has no focus' });
		// Obsidian pads the table when a cell gets the focus. Compare with the text after the click.
		await settle();
		const before = (await state()).text;
		expect(before).toContain('Ana');
		await cutKeys();
		await settle();
		const s = await state();
		expect(s.text).toBe(before);
		expect(s.clipboard).toBe(SENTINEL);
		await setOptions('allow', 'allow');
		await td.click();
		await cutKeys();
		const cut = await waitState((x) => x.clipboard.trim() === 'Ana', 'Obsidian did not cut the cell text');
		expect(cut.text).not.toContain('Ana');
	});

	it('A7 Pro second press: the first Ctrl+X is stopped, a second press cuts the line', async function () {
		await browser.executeObsidian(async ({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, { pro: { opts: { http: unknown }; refreshNow(): Promise<unknown> } }> } }).plugins.plugins[id]!;
			p.pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'fixture-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
			app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
			await p.pro.refreshNow();
		}, pluginId);
		try {
			await setOptions('twice', 'allow', false);
			await openNote('live');
			await select(3, 5);
			await cutKeys();
			await settle(500);
			const first = await state();
			expect(first.text).toBe(NOTE);
			expect(first.clipboard).toBe(SENTINEL);
			expect(first.notices).toEqual(['Nothing is selected. Press Ctrl+X again to cut the line.']);
			await cutKeys();
			const second = await waitState((x) => x.clipboard === 'Second line of text.', 'the second press did not cut the line');
			expect(second.text).toBe(NOTE.replace('Second line of text.\n', ''));
			// After 2 seconds the first press is forgotten.
			await select(2, 1);
			await cutKeys();
			await settle(2400);
			await cutKeys();
			await settle();
			expect((await state()).text).toBe(second.text);
		} finally {
			await browser.executeObsidian(({ app }, id) => {
				(app as unknown as { plugins: { plugins: Record<string, { pro: { signOut(): void } }> } }).plugins.plugins[id]!.pro.signOut();
			}, pluginId);
		}
	});

	it('A9 with the plugin off, Ctrl+X cuts the line again', async function () {
		await setOptions('block', 'allow');
		await openNote('live');
		await browser.executeObsidian(async ({ app }, id) => {
			await (app as unknown as { plugins: { disablePlugin(id: string): Promise<void> } }).plugins.disablePlugin(id);
		}, pluginId);
		try {
			await select(3, 5);
			await cutKeys();
			const s = await waitState((x) => x.clipboard === 'Second line of text.', 'Obsidian did not cut the line with the plugin off');
			expect(s.text).toBe(NOTE.replace('Second line of text.\n', ''));
		} finally {
			await browser.executeObsidian(async ({ app }, id) => {
				await (app as unknown as { plugins: { enablePlugin(id: string): Promise<boolean> } }).plugins.enablePlugin(id);
			}, pluginId);
		}
	});
});
