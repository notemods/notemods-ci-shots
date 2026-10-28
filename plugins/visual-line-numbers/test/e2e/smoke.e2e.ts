import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId, reloadPlugin } from './load';

// Real-app checks of the gutter on the sample notes in test/e2e/vault/Visual Line Numbers.
// The numbers are compared with the display rows that the browser draws, not with the plugin's own count.
const DIR = 'Visual Line Numbers';
const LONG = `${DIR}/Long lines.md`;
const FOLDS = `${DIR}/Folded sections.md`;
const HIDDEN = `${DIR}/Hidden gutter.md`;

interface Snapshot {
	/** Gutter text of each row, one array for each gutter block. */
	gutter: string[][];
	/** Display rows that the browser draws for each .cm-line, from client rects. */
	lines: number[];
	hints: number;
	current: number;
	blocks: number;
}

/** Reads the gutter of the visible editor and the rows of its lines. */
async function snapshot(): Promise<Snapshot> {
	return browser.execute(() => {
		const root = document.querySelector('.workspace-leaf.mod-active .cm-editor');
		const empty = { gutter: [], lines: [], hints: 0, current: 0, blocks: 0 };
		if (!root) return empty;
		const boxes = [...root.querySelectorAll<HTMLElement>('.vln-gutter .vln-rows')].filter((b) => getComputedStyle(b.parentElement ?? b).visibility !== 'hidden');
		const gutter = boxes.map((b) => [...b.querySelectorAll('.vln-row')].map((r) => r.textContent ?? ''));
		const lines = [...root.querySelectorAll<HTMLElement>('.cm-content > .cm-line')].map((line) => {
			const range = document.createRange();
			range.selectNodeContents(line);
			const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0).sort((a, b) => a.top - b.top);
			let bands = 0;
			let bottom = -Infinity;
			for (const r of rects) {
				if (r.top >= bottom - 2) bands++;
				bottom = Math.max(bottom, r.bottom);
			}
			return Math.max(1, bands);
		});
		return {
			gutter,
			lines,
			hints: root.querySelectorAll('.vln-row[data-hint]').length,
			current: root.querySelectorAll('.vln-row.vln-current').length,
			blocks: boxes.length,
		};
	});
}

async function waitSnapshot(pred: (s: Snapshot) => boolean, msg: string, timeout = 15000): Promise<Snapshot> {
	let last: Snapshot | null = null;
	await browser.waitUntil(
		async () => {
			last = await snapshot();
			return pred(last);
		},
		{ timeout, interval: 250, timeoutMsg: `${msg}; last ${JSON.stringify(last)}` },
	);
	return last!;
}

/** Saved settings of the plugin, changed in the running app. The same call as the settings tab makes. */
async function configure(patch: Record<string, unknown>): Promise<void> {
	await browser.executeObsidian(
		({ app }, id, p) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, { settings: object; applySettings(): void }> } }).plugins.plugins[id]!;
			Object.assign(plugin.settings, p);
			plugin.applySettings();
		},
		pluginId,
		patch,
	);
}

async function setCursorLine(line: number): Promise<void> {
	await browser.executeObsidian(({ app }, l) => {
		const editor = app.workspace.activeEditor?.editor;
		editor?.setCursor({ line: l, ch: 0 });
		editor?.focus();
	}, line);
}

async function command(id: string): Promise<void> {
	await browser.executeObsidianCommand(id);
}

/** The service uses Electron for window sizing because Obsidian omits the browser window CDP command. */
async function windowSize(): Promise<[number, number]> {
	return browser.execute(() => {
		const host = window as unknown as { electron: { remote: { getCurrentWindow(): { getSize(): [number, number] } } } };
		return host.electron.remote.getCurrentWindow().getSize();
	}) as Promise<[number, number]>;
}

async function resizeWindow(width: number, height: number): Promise<void> {
	await browser.execute((w, h) => {
		const host = window as unknown as { electron: { remote: { getCurrentWindow(): { setSize(width: number, height: number): void } } } };
		host.electron.remote.getCurrentWindow().setSize(w, h);
	}, width, height);
}

/** Waits until the metadata cache knows the headings of a note. Folding a section needs them. */
async function waitHeadings(path: string, count: number): Promise<void> {
	await browser.waitUntil(
		async () =>
			browser.executeObsidian(({ app }, p, n) => {
				const f = app.vault.getFileByPath(p);
				return f !== null && (app.metadataCache.getFileCache(f)?.headings?.length ?? 0) >= n;
			}, path, count),
		{ timeout: 20000, interval: 250, timeoutMsg: `no headings in the metadata cache for ${path}` },
	);
}

/** Opens the folds note, unfolds everything, then folds Section A and Section B (lines 5 and 12). */
async function openFolded(): Promise<Snapshot> {
	await obsidianPage.openFile(FOLDS);
	await waitHeadings(FOLDS, 4);
	await setCursorLine(2);
	await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.exec('unfoldAll'));
	const open = await waitSnapshot((x) => x.lines.length >= 15, 'unfolded note not drawn');
	let rows = open.lines.length;
	for (const line of [4, 11]) {
		await setCursorLine(line);
		await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.exec('toggleFold'));
		const next = await waitSnapshot((x) => x.lines.length < rows, `fold at line ${line + 1} not drawn`);
		rows = next.lines.length;
	}
	await setCursorLine(2);
	return waitSnapshot((x) => x.gutter.some((g) => g[0] === '0') && x.lines.length === rows, 'cursor not on line 3');
}

/** Pro with a stubbed GitHub reply and a fake token. No request leaves the machine. */
async function setSponsor(reply: 'monthly' | 'none' | 'signed-out'): Promise<void> {
	await browser.executeObsidian(
		async ({ app }, id, kind) => {
			interface Pro {
				opts: { http: unknown };
				refreshNow(): Promise<void>;
				signOut(): void;
			}
			const p = (app as unknown as { plugins: { plugins: Record<string, { pro: Pro }> } }).plugins.plugins[id]!;
			if (kind === 'signed-out') {
				p.pro.signOut();
				return;
			}
			const sponsorship = kind === 'monthly' ? { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } : null;
			const reply = { status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: sponsorship } } } };
			p.pro.opts.http = () => Promise.resolve(reply);
			app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
			await p.pro.refreshNow();
		},
		pluginId,
		reply,
	);
}

/** Computed color of the first relative-mode number row in the visible editor. */
async function relativeColor(): Promise<string> {
	return browser.execute(() => {
		const row = document.querySelector('.workspace-leaf.mod-active .vln-row.vln-rel:not(.vln-cur)');
		return row ? getComputedStyle(row).color : '';
	});
}

async function isPro(): Promise<boolean> {
	return browser.executeObsidian(({ app }, id) => (app as unknown as { plugins: { plugins: Record<string, { pro: { isPro(): boolean } }> } }).plugins.plugins[id]!.pro.isPro(), pluginId);
}

const FREE = { enabled: true, mode: 'relative', countFolded: false, highlightCurrent: false, motionHint: false, noteProperty: false, colorAbsolute: '', colorRelative: '', colorHybrid: '' };

/** Row distances that the gutter must show, from the display rows the browser draws and the cursor line. */
function expectedRelative(lines: number[], cursorLine: number): string[][] {
	const starts: number[] = [];
	let at = 0;
	for (const n of lines) {
		starts.push(at);
		at += n;
	}
	return lines.map((n, i) => Array.from({ length: n }, (_, j) => String(Math.abs(starts[i]! + j - starts[cursorLine]!))));
}

describe(`${pluginId} in the real app`, function () {
	before(async function () {
		await setSponsor('signed-out');
		await configure(FREE);
	});

	it('is enabled and reloads with no console errors', async function () {
		const state = await reloadPlugin(pluginId);
		expect(state).toEqual({ enabled: true, reloaded: true, errors: [] });
	});

	it('shows one number for each wrapped display row of every line', async function () {
		await configure(FREE);
		await obsidianPage.openFile(LONG);
		await setCursorLine(2);
		const s = await waitSnapshot((x) => x.blocks >= 10 && x.gutter.length === x.lines.length, 'gutter not drawn');
		expect(Math.max(...s.lines)).toBeGreaterThanOrEqual(3);
		expect(s.gutter.map((g) => g.length)).toEqual(s.lines);
	});

	it('relative mode: the numbers are the row distances from the cursor and change with the cursor', async function () {
		await configure(FREE);
		await obsidianPage.openFile(LONG);
		await setCursorLine(2);
		const a = await waitSnapshot((x) => x.gutter[2]?.[0] === '0', 'cursor on line 3 not at 0');
		expect(a.gutter).toEqual(expectedRelative(a.lines, 2));
		await setCursorLine(4);
		const b = await waitSnapshot((x) => x.gutter[4]?.[0] === '0', 'cursor on line 5 not at 0');
		expect(b.gutter).toEqual(expectedRelative(b.lines, 4));
		expect(b.gutter).not.toEqual(a.gutter);
		await setCursorLine(6);
		const c = await waitSnapshot((x) => x.gutter[6]?.[0] === '0', 'cursor on line 7 not at 0');
		expect(c.gutter).toEqual(expectedRelative(c.lines, 6));
	});

	it('hybrid mode shows the line number on the cursor row, absolute mode on the first row of each line', async function () {
		await obsidianPage.openFile(LONG);
		await configure({ ...FREE, mode: 'hybrid' });
		await setCursorLine(4);
		const h = await waitSnapshot((x) => x.gutter[4]?.[0] === '5', 'hybrid cursor number');
		expect(h.gutter[3]![0]).toBe('1');
		await configure({ ...FREE, mode: 'absolute' });
		const a = await waitSnapshot((x) => x.gutter[2]?.[0] === '3', 'absolute numbers');
		expect(a.gutter.map((g) => g[0])).toEqual(a.gutter.map((_, i) => String(i + 1)));
		expect(a.gutter[2]!.slice(1).every((t) => t === '')).toBe(true);
	});

	it('dual mode has document numbers and display row distances, and the mode commands include it', async function () {
		await setSponsor('signed-out');
		await configure(FREE);
		await obsidianPage.openFile(LONG);
		await setCursorLine(2);
		await command(`${pluginId}:mode-dual`);
		const measured = (s: Snapshot) => s.gutter.length === s.lines.length && s.gutter.every((rows, i) => rows.length === s.lines[i]);
		const a = await waitSnapshot((x) => x.gutter[2]?.[0] === '3 | 0' && measured(x), 'dual cursor row after wrap measurement');
		const expected = (s: Snapshot, cursorLine: number) => expectedRelative(s.lines, cursorLine).map((rows, i) => rows.map((distance, j) => `${j === 0 ? i + 1 : ''} | ${distance}`));
		expect(Math.max(...a.lines)).toBeGreaterThanOrEqual(3);
		expect(a.gutter).toEqual(expected(a, 2));
		await browser.keys(['ArrowDown']);
		const continuation = await waitSnapshot((x) => x.gutter[2]?.[1] === ' | 0', 'dual cursor on a continuation row');
		expect(continuation.gutter[2]![0]).toBe('3 | 1');
		expect(continuation.gutter[2]![2]).toBe(' | 1');
		const [originalWidth, originalHeight] = await windowSize();
		try {
			for (const width of [760, 745, 730]) {
				await resizeWindow(width, originalHeight);
				await browser.pause(300);
				await setCursorLine(2);
				await waitSnapshot((x) => x.gutter[2]?.[0] === '3 | 0' && measured(x), 'dual rows after a window resize');
				await browser.keys(['ArrowDown']);
				const resized = await waitSnapshot((x) => x.gutter[2]?.[1] === ' | 0' && measured(x), 'dual cursor after a window resize');
				expect(resized.gutter[2]![0]).toBe('3 | 1');
			}
		} finally {
			await resizeWindow(originalWidth, originalHeight);
			await browser.pause(300);
		}
		await setCursorLine(4);
		const b = await waitSnapshot((x) => x.gutter[4]?.[0] === '5 | 0' && measured(x), 'dual after cursor move');
		expect(b.gutter).toEqual(expected(b, 4));
		await command(`${pluginId}:cycle-mode`);
		await waitSnapshot((x) => x.gutter[2]?.[0] === '3', 'cycle from dual to absolute');
		await command(`${pluginId}:mode-hybrid`);
		await command(`${pluginId}:cycle-mode`);
		await waitSnapshot((x) => x.gutter[4]?.[0] === '5 | 0', 'cycle from hybrid to dual');
		await configure(FREE);
	});

	it('the toggle command removes and restores the gutter, the mode commands change the mode', async function () {
		await configure(FREE);
		await obsidianPage.openFile(LONG);
		await waitSnapshot((x) => x.blocks > 0, 'gutter not drawn');
		await command(`${pluginId}:toggle`);
		await waitSnapshot((x) => x.blocks === 0, 'gutter still drawn after toggle');
		await command(`${pluginId}:toggle`);
		await waitSnapshot((x) => x.blocks > 0, 'gutter not back after second toggle');
		await command(`${pluginId}:mode-absolute`);
		await waitSnapshot((x) => x.gutter[0]?.[0] === '1' && x.gutter[1]?.[0] === '2', 'absolute mode command');
		await command(`${pluginId}:cycle-mode`);
		await waitSnapshot((x) => x.gutter[0]?.[0] !== '1' || x.gutter[1]?.[0] === '1', 'cycle to relative mode');
		await configure(FREE);
	});

	it('with Vim key bindings, 5gj lands on the row that the gutter numbered 5', async function () {
		await configure(FREE);
		await obsidianPage.openFile(LONG);
		const setVim = (on: boolean) => browser.executeObsidian(({ app }, v) => (app.vault as unknown as { setConfig(k: string, v: unknown): void }).setConfig('vimMode', v), on);
		await setVim(true);
		try {
			await setCursorLine(2);
			await browser.keys(['Escape']);
			const before = await waitSnapshot((x) => x.gutter[2]?.[0] === '0', 'cursor on line 3 not at 0');
			const target = before.gutter.flat().indexOf('5');
			expect(target).toBeGreaterThan(before.gutter[2]!.length);
			await browser.keys(['5', 'g', 'j']);
			const after = await waitSnapshot((x) => x.gutter.flat().indexOf('0') === target, `cursor did not land on row ${target}`);
			expect(after.gutter.flat().indexOf('0')).toBe(target);
		} finally {
			await setVim(false);
		}
	});

	it('Pro is locked when GitHub reports no sponsorship: saved Pro choices have no effect', async function () {
		await setSponsor('none');
		expect(await isPro()).toBe(false);
		await configure({ ...FREE, mode: 'hybrid', countFolded: true, highlightCurrent: true, motionHint: true, noteProperty: true });
		await obsidianPage.openFile(LONG);
		await setCursorLine(2);
		const s = await waitSnapshot((x) => x.gutter[2]?.[0] === '3', 'hybrid numbers');
		expect(s.current).toBe(0);
		expect(s.hints).toBe(0);
		await configure({ colorRelative: '#4f8fd6', colorHybrid: '#e08a1e' });
		await configure({ mode: 'relative' });
		expect(await relativeColor()).not.toBe('rgb(79, 143, 214)');
		await configure({ colorRelative: '', colorHybrid: '' });
		await obsidianPage.openFile(HIDDEN);
		const h = await waitSnapshot((x) => x.blocks > 0, 'gutter in the hidden note');
		expect(h.blocks).toBeGreaterThan(0);
	});

	it('free: a fold counts as the one row you see', async function () {
		await setSponsor('none');
		await configure(FREE);
		await openFolded();
		const s = await waitSnapshot((x) => x.gutter[6]?.[0] === '4', 'free count after folds');
		const col = s.gutter.map((g) => g[0]);
		expect(col.slice(0, 7)).toEqual(['2', '1', '0', '1', '2', '3', '4']);
	});

	it('Pro: fold aware counting, current row, motion hint, and the note property', async function () {
		await setSponsor('monthly');
		expect(await isPro()).toBe(true);
		await configure({ ...FREE, countFolded: true, highlightCurrent: true, motionHint: true, noteProperty: true });
		await openFolded();
		const f = await waitSnapshot((x) => x.gutter[6]?.[0] === '14', 'fold aware count 14 for Section C');
		expect(f.gutter.map((g) => g[0]).slice(0, 7)).toEqual(['2', '1', '0', '1', '2', '9', '14']);
		expect(f.current).toBe(1);
		expect(f.hints).toBeGreaterThan(0);
		await configure({ colorRelative: '#4f8fd6' });
		await browser.waitUntil(async () => (await relativeColor()) === 'rgb(79, 143, 214)', { timeout: 10000, timeoutMsg: 'the Pro color did not apply' });
		await configure({ colorRelative: '' });
		await browser.waitUntil(async () => (await relativeColor()) !== 'rgb(79, 143, 214)', { timeout: 10000, timeoutMsg: 'the color did not reset' });
		await obsidianPage.openFile(HIDDEN);
		await waitSnapshot((x) => x.blocks === 0, 'gutter should be hidden by the note property');
		await obsidianPage.openFile(LONG);
		await waitSnapshot((x) => x.blocks > 0, 'gutter should be back in a note without the property');
		await setSponsor('signed-out');
		await configure(FREE);
		await waitSnapshot((x) => x.current === 0 && x.hints === 0, 'Pro features should switch off after sign out');
		await obsidianPage.openFile(FOLDS);
		await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.exec('unfoldAll'));
	});
});
