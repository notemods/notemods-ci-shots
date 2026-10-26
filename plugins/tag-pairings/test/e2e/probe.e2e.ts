import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId, reloadPlugin } from './load';

// Real-app checks for acceptance criteria 8 to 12 of the spec, on minAppVersion and on the latest app (wdio.conf.mts).
const NOTES: Record<string, string> = {
	'Pairs/A.md': 'Notes on #book #novel and #fiction.\n',
	'Pairs/B.md': '---\ntags: [book, novel]\n---\nBody text.\n',
	'Pairs/C.md': 'Read #book #fiction #Reading\n',
	'Pairs/D.md': '#book #history\n',
	'Pairs/E.md': '#novel #fiction\n',
	'Pairs/F.md': 'Code below.\n\n```\n#book #fakecode\n```\n',
};
const ACTIVE = '.workspace-leaf.mod-active';

interface PluginShape {
	index: { rank(anchor: string, opts?: unknown): { tag: string; display: string; count: number }[]; size: number } | null;
	buildMs: number;
}

/** Writes the notes and waits until the plugin index has the tags of every note. */
async function seed(): Promise<void> {
	for (const [p, t] of Object.entries(NOTES)) await obsidianPage.write(p, t);
	await obsidianPage.write('Host.md', 'Start\n');
	await browser.waitUntil(
		async () =>
			browser.executeObsidian(({ app }, id) => {
				const p = (app as unknown as { plugins: { plugins: Record<string, PluginShape> } }).plugins.plugins[id];
				const r = p?.index?.rank('book') ?? [];
				return r.map((x) => x.tag + String(x.count)).join(',') === 'fiction2,novel2,history1,reading1';
			}, pluginId),
		{ timeout: 15000, interval: 100, timeoutMsg: 'the index did not get the tags of the notes' },
	);
}

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
}

/**
 * Opens Host.md with the given text, in Live Preview (source false) or Source mode (source true), cursor at the end.
 * It uses one Markdown tab only: obsidianPage.openFile opens a new tab each time, and Obsidian syncs every open view of
 * the same note and merges each save into the other views. With many views a late merge put setup text into the middle
 * of the typed tag (probe run 40366514579). The text is saved, and the test waits until the file on disk has it.
 */
async function openHost(text: string, source: boolean): Promise<void> {
	await browser.executeObsidian(
		async ({ app, obsidian }, src) => {
			const file = app.vault.getAbstractFileByPath('Host.md');
			if (!(file instanceof obsidian.TFile)) throw new Error('no Host.md');
			const leaves = app.workspace.getLeavesOfType('markdown');
			const leaf = leaves[0] ?? app.workspace.getLeaf(false);
			for (const other of leaves.slice(1)) other.detach();
			await leaf.openFile(file);
			app.workspace.setActiveLeaf(leaf, { focus: true });
			const s = leaf.getViewState();
			await leaf.setViewState({ ...s, state: { ...s.state, mode: 'source', source: src } });
		},
		source,
	);
	await focusWindow();
	await browser.$(`${ACTIVE} .markdown-source-view .cm-content`).click();
	await setHostText(text);
	await browser.executeObsidian(({ app }) => {
		const e = app.workspace.activeEditor?.editor;
		if (!e) return;
		e.focus();
		const last = e.lastLine();
		e.setCursor({ line: last, ch: e.getLine(last).length });
	});
	await browser.keys('Escape');
}

/** Sets the text of the open host note, saves it, and waits until the file on disk has the same text. */
async function setHostText(text: string): Promise<void> {
	await browser.executeObsidian(async ({ app, obsidian }, t) => {
		const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
		if (!view || view.file?.path !== 'Host.md') throw new Error('the host note is not the active view');
		if (view.editor.getValue() !== t) view.editor.setValue(t);
		await view.save();
	}, text);
	let disk = '';
	await browser
		.waitUntil(
			async () => {
				disk = await browser.executeObsidian(({ app }) => app.vault.adapter.read('Host.md'));
				return disk === text;
			},
			{ timeout: 10000, interval: 100 },
		)
		.catch(() => {
			throw new Error(`Host.md on disk is ${JSON.stringify(disk)}, not ${JSON.stringify(text)}`);
		});
}

/** The texts of the items of the Tag Pairings box, or [] when it is not open. */
async function items(): Promise<string[]> {
	return browser.execute(() => Array.from(document.querySelectorAll('.suggestion-container .tag-pairings-item .tag-pairings-tag')).map((e) => e.textContent ?? ''));
}

async function waitItems(want: string[]): Promise<void> {
	let last: string[] = [];
	await browser
		.waitUntil(
			async () => {
				last = await items();
				return JSON.stringify(last) === JSON.stringify(want);
			},
			{ timeout: 5000, interval: 50 },
		)
		.catch(() => {
			throw new Error(`box items are ${JSON.stringify(last)}, not ${JSON.stringify(want)}`);
		});
}

async function lastLine(): Promise<string> {
	return browser.executeObsidian(({ app }) => {
		const e = app.workspace.activeEditor?.editor;
		return e ? e.getLine(e.lastLine()) : '';
	});
}

/** Sets the host note back to "Start" and waits until the index has the seed rank again (the host note counts too). */
async function resetHost(): Promise<void> {
	await setHostText('Start\n');
	await browser.waitUntil(
		async () =>
			browser.executeObsidian(({ app }, id) => {
				const p = (app as unknown as { plugins: { plugins: Record<string, PluginShape> } }).plugins.plugins[id];
				const r = p?.index?.rank('book') ?? [];
				return r.map((x) => x.tag + String(x.count)).join(',') === 'fiction2,novel2,history1,reading1';
			}, pluginId),
		{ timeout: 15000, interval: 100, timeoutMsg: 'the index did not go back to the seed rank' },
	);
}

async function typeText(text: string): Promise<void> {
	for (const ch of text) await browser.keys(ch);
}
// TEMPORARY PROBE (not for main): runs the list tests 20 times and logs each editor transaction and each Host.md event.
interface LogEntry {
	t: number;
	k: string;
	d: string;
}

async function installLogger(): Promise<void> {
	await browser.executeObsidian(({ app }) => {
		const w = window as unknown as { __tpLog?: LogEntry[]; __tpVaultHooked?: boolean };
		w.__tpLog ??= [];
		const log = (k: string, d: string) => w.__tpLog!.push({ t: Math.round(performance.now()), k, d });
		const e = app.workspace.activeEditor?.editor as unknown as { cm?: { update(trs: unknown[]): void; __tpHooked?: boolean } } | undefined;
		const view = e?.cm;
		if (view && !view.__tpHooked) {
			view.__tpHooked = true;
			const orig = view.update.bind(view);
			view.update = (trs: unknown[]) => {
				for (const tr of trs as { docChanged: boolean; changes: { iterChanges(f: (a: number, b: number, c: number, d: number, ins: { toString(): string }) => void): void }; annotations?: { value: unknown }[] }[]) {
					if (!tr.docChanged) continue;
					const ch: string[] = [];
					tr.changes.iterChanges((fa, ta, _fb, _tb, ins) => ch.push(`${fa}-${ta}:${JSON.stringify(ins.toString())}`));
					const ann = (tr.annotations ?? []).map((a) => (typeof a.value === 'string' ? a.value : typeof a.value)).join('|');
					log('tr', `${ann} ${ch.join(' ')}`);
				}
				orig(trs);
			};
			log('hook', 'editor view hooked');
		}
		if (!w.__tpVaultHooked) {
			w.__tpVaultHooked = true;
			app.vault.on('modify', (f) => {
				if (f.path !== 'Host.md') return;
				const at = Math.round(performance.now());
				void app.vault.read(f as never).then((txt) => w.__tpLog!.push({ t: at, k: 'modify', d: JSON.stringify(txt) }));
			});
			try {
				(app.vault as unknown as { on(n: string, cb: (p: string) => void): void }).on('raw', (p) => {
					if (p === 'Host.md') log('raw', p);
				});
			} catch {
				log('raw', 'no raw event');
			}
		}
	});
}

async function mark(label: string): Promise<void> {
	await browser.executeObsidian(({ app }, l) => {
		const w = window as unknown as { __tpLog?: LogEntry[] };
		const e = app.workspace.activeEditor?.editor;
		w.__tpLog?.push({ t: Math.round(performance.now()), k: 'mark', d: `${l} editor=${JSON.stringify(e?.getValue() ?? null)}` });
	}, label);
}

async function takeLog(): Promise<string[]> {
	return browser.executeObsidian(() => {
		const w = window as unknown as { __tpLog?: LogEntry[] };
		const out = (w.__tpLog ?? []).sort((a, b) => a.t - b.t).map((x) => `${x.t} ${x.k} ${x.d}`);
		w.__tpLog = [];
		return out;
	});
}

async function editorText(): Promise<string> {
	return (await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.getValue())) ?? '';
}

describe('PROBE list tests 20 times', function () {
	before(async function () {
		await seed();
	});

	it('runs Tab indent then Enter in a list item 20 times and logs editor and file events', async function () {
		this.timeout(900_000);
		const fails: string[] = [];
		for (let i = 0; i < 20; i++) {
			for (const kind of ['tab', 'enter'] as const) {
				let ok = true;
				let why = '';
				await openHost('Start\n- first\n- buy milk ', false);
				await installLogger();
				await mark(`iter ${i} ${kind} after openHost`);
				await typeText('#book ');
				await mark(`iter ${i} ${kind} after typing`);
				const got = await browser
					.waitUntil(async () => JSON.stringify(await items()) === JSON.stringify(['#fiction', '#novel', '#history', '#Reading']), { timeout: 5000, interval: 50 })
					.then(() => true)
					.catch(() => false);
				if (!got) {
					ok = false;
					why = `box ${JSON.stringify(await items())}`;
				} else if (kind === 'tab') {
					await browser.keys('Tab');
					const done = await browser.waitUntil(async () => /^(\t| {2,4})- buy milk #book $/u.test(await lastLine()), { timeout: 5000 }).then(() => true).catch(() => false);
					if (!done) {
						ok = false;
						why = 'no indent';
					}
				} else {
					await browser.keys('Enter');
					const done = await browser.waitUntil(async () => (await editorText()) === 'Start\n- first\n- buy milk #book \n- ', { timeout: 5000 }).then(() => true).catch(() => false);
					if (!done) {
						ok = false;
						why = 'no new item';
					}
				}
				await mark(`iter ${i} ${kind} end ok=${String(ok)}`);
				await browser.keys('Escape');
				await resetHost();
				await mark(`iter ${i} ${kind} after resetHost`);
				const log = await takeLog();
				if (!ok || (i === 0 && kind === 'enter')) {
					console.log(`PROBE iter ${i} ${kind} ok=${String(ok)} ${why}`);
					for (const l of log) console.log(`PROBE   ${l}`);
				}
				if (!ok) fails.push(`${i} ${kind} ${why}`);
			}
		}
		console.log(`PROBE SUMMARY ${fails.length} of 40 failed: ${JSON.stringify(fails)}`);
		expect(fails).toEqual([]);
	});
});
