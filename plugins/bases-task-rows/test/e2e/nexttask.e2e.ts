import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId } from './load';
import { DIR } from './rows';

// 1.5.0 in a real Obsidian: "Count only tasks with tag" and the Next task column of the Task progress view
// (forum 103074 post 6). The notes of this spec live in their own folder, and the spec deletes them at the end.
const T = 'Next action e2e';
const A = `${T}/A.md`;
const B = `${T}/B.md`;
const BASE = `${T}/Projects.base`;
const MANY = 'Next action e2e many';
const MANY_BASE = `${MANY}/Many.base`;
const N_MANY = 1000;

interface State {
	heads: string[];
	cells: Record<string, string[]>;
	info: string;
	paths: string[];
}

/** State of the connected Task progress view that shows a row of the given folder, or null. */
async function stateOf(folder: string): Promise<State | null> {
	return browser.executeObsidian(
		({ app }, id, dir) => {
			interface V {
				rootEl: HTMLElement;
				notes: { file: { path: string } }[];
				shownPaths(): string[];
			}
			const p = (app as unknown as { plugins: { plugins: Record<string, { progressViews?: Set<V> }> } }).plugins.plugins[id];
			const v = [...(p?.progressViews ?? [])].find((x) => x.rootEl.isConnected && x.notes.some((n) => n.file.path.startsWith(`${dir}/`)));
			if (!v) return null;
			const cells: Record<string, string[]> = {};
			for (const tr of Array.from(v.rootEl.querySelectorAll<HTMLElement>('tr.btp-row'))) cells[tr.dataset.path ?? ''] = Array.from(tr.querySelectorAll('td')).map((td) => td.textContent ?? '');
			return {
				heads: Array.from(v.rootEl.querySelectorAll('thead th')).map((th) => th.textContent ?? ''),
				cells,
				info: v.rootEl.querySelector('.btr-info')?.textContent ?? '',
				paths: v.shownPaths(),
			};
		},
		pluginId,
		folder,
	);
}

async function waitState(folder: string, test: (s: State) => boolean, timeout = 15000): Promise<State> {
	let last: State | null = null;
	await browser.waitUntil(
		async () => {
			last = await stateOf(folder);
			return last !== null && test(last);
		},
		{ interval: 150, timeout, timeoutMsg: `Task progress view not as expected: ${JSON.stringify(last)?.slice(0, 1500)}` },
	);
	return last!;
}

/** Sets one option of the Task progress view of the folder through the view config, as the view menu does. No manual render. */
async function setOption(folder: string, key: string, value: unknown): Promise<void> {
	await browser.executeObsidian(
		({ app }, id, dir, k, val) => {
			interface V {
				rootEl: HTMLElement;
				notes: { file: { path: string } }[];
				config: { set(k: string, v: unknown): void };
			}
			const p = (app as unknown as { plugins: { plugins: Record<string, { progressViews: Set<V> }> } }).plugins.plugins[id]!;
			const v = [...p.progressViews].find((x) => x.rootEl.isConnected && x.notes.some((n) => n.file.path.startsWith(`${dir}/`)))!;
			v.config.set(k, val);
		},
		pluginId,
		folder,
		key,
		value,
	);
}

describe(`${pluginId} Next task column`, function () {
	before(async function () {
		await browser.executeObsidian(
			async ({ app }, dir, a, b, base) => {
				await app.vault.createFolder(dir);
				await app.vault.create(a, '# A\n- [ ] call #next-action\n- [ ] buy paint\n');
				// B has the tag in its frontmatter and in a paragraph. Neither is a task tag.
				await app.vault.create(b, '---\ntags: [next-action]\n---\nSee #next-action.\n- [ ] buy paint\n- [x] plan\n');
				await app.vault.create(base, `filters:\n  and:\n    - file.inFolder("${dir}")\nviews:\n  - type: task-progress\n    name: Next actions\n    progressSort: note\n    tag: "#next-action"\n`);
			},
			T,
			A,
			B,
			BASE,
		);
	});

	after(async function () {
		await browser.executeObsidian(
			async ({ app }, id, dirs) => {
				const p = (app as unknown as { plugins: { plugins: Record<string, { pro: { signOut(): void } }> } }).plugins.plugins[id]!;
				p.pro.signOut();
				for (const leaf of app.workspace.getLeavesOfType('bases')) leaf.detach();
				for (const leaf of app.workspace.getLeavesOfType('markdown')) leaf.detach();
				for (const d of dirs) {
					const folder = app.vault.getFolderByPath(d);
					if (folder) await app.vault.delete(folder, true);
				}
			},
			pluginId,
			[T, MANY],
		);
	});

	it('note A shows Open 1 and Next task "call"; note B shows 0 and an empty cell', async function () {
		await obsidianPage.openFile(BASE);
		const s = await waitState(T, (x) => x.paths.length === 2);
		expect(s.heads).toEqual(['Note', 'Open', 'Done', 'Total', 'Progress', 'Next due', 'Overdue', 'Next task']);
		expect(s.cells[A]).toEqual(['A', '1', '0', '1', '0%', '', '0', 'call']);
		expect(s.cells[B]).toEqual(['B', '0', '0', '0', '', '', '0', '']);
		expect(s.info).toBe('2 notes. Counting only tasks tagged #next-action.');
	});

	it('an edit of the task text in the note editor updates the Next task cell, and a tick empties it', async function () {
		await browser.executeObsidian(async ({ app }, a) => {
			const leaf = app.workspace.getLeaf('split', 'vertical');
			await leaf.openFile(app.vault.getFileByPath(a)!);
			app.workspace.setActiveLeaf(leaf, { focus: true });
			const editor = (leaf.view as unknown as { editor: { setLine(n: number, t: string): void } }).editor;
			editor.setLine(1, '- [ ] email Ana #next-action');
		}, A);
		let s = await waitState(T, (x) => x.cells[A]?.[7] === 'email Ana', 15000);
		expect(s.cells[A]!.slice(1, 4)).toEqual(['1', '0', '1']);
		await browser.executeObsidian(({ app }) => {
			const editor = app.workspace.activeEditor?.editor;
			editor?.setLine(1, '- [x] email Ana #next-action');
		});
		s = await waitState(T, (x) => x.cells[A]?.[7] === '' && x.cells[A]?.[2] === '1', 15000);
		expect(s.cells[A]).toEqual(['A', '0', '1', '1', '100%', '', '0', '']);
		await browser.executeObsidian(({ app }) => {
			app.workspace.activeEditor?.editor?.setLine(1, '- [ ] call #next-action');
		});
		await waitState(T, (x) => x.cells[A]?.[7] === 'call', 15000);
	});

	it('a change of the tag option in the view config updates the table without a manual render', async function () {
		await setOption(T, 'tag', '');
		let s = await waitState(T, (x) => x.heads.length === 7);
		expect(s.cells[A]!.slice(0, 5)).toEqual(['A', '2', '0', '2', '0%']);
		expect(s.info).toBe('2 notes');
		await setOption(T, 'tag', 'Next-Action');
		s = await waitState(T, (x) => x.heads.length === 8);
		expect(s.cells[A]![7]).toBe('call');
	});

	it('with Pro, "Only notes without a next task" keeps only note B; signed out it has no effect', async function () {
		await setOption(T, 'onlyWithoutNext', true);
		let s = await waitState(T, (x) => x.info.includes('pro feature'));
		expect(s.paths).toEqual([A, B]);
		await browser.executeObsidian(async ({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, { pro: { opts: { http: unknown }; refreshNow(): Promise<void> } }> } }).plugins.plugins[id]!;
			p.pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
			app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
			await p.pro.refreshNow();
		}, pluginId);
		s = await waitState(T, (x) => x.paths.length === 1);
		expect(s.paths).toEqual([B]);
		await setOption(T, 'onlyWithoutNext', false);
		await waitState(T, (x) => x.paths.length === 2);
		await browser.executeObsidian(({ app }, id) => {
			(app as unknown as { plugins: { plugins: Record<string, { pro: { signOut(): void } }> } }).plugins.plugins[id]!.pro.signOut();
		}, pluginId);
	});

	it('reads the saved Sort by back from the base file after the base opens again', async function () {
		await setOption(T, 'progressSort', 'note');
		await setOption(T, 'descending', true);
		await waitState(T, (x) => x.paths[0] === B);
		const saved = await browser.executeObsidian(async ({ app }, base) => {
			for (const leaf of app.workspace.getLeavesOfType('bases')) leaf.detach();
			await new Promise((r) => setTimeout(r, 300));
			return app.vault.adapter.read(base);
		}, BASE);
		expect(saved).toContain('progressSort: note');
		expect(saved).toContain('descending: true');
		await obsidianPage.openFile(BASE);
		const s = await waitState(T, (x) => x.paths.length === 2);
		expect(s.paths).toEqual([B, A]);
		await setOption(T, 'descending', false);
		await waitState(T, (x) => x.paths[0] === A);
	});

	it(`${N_MANY} notes with the tag option: the view renders, keeps its scroll position on an update, and never blocks the app for 1 second`, async function () {
		this.timeout(300_000);
		await browser.executeObsidian(
			async ({ app }, dir, base, n) => {
				await app.vault.createFolder(dir);
				for (let i = 0; i < n; i++) {
					const lines = [`# Project ${i}`, `- [ ] step ${i}${i % 3 === 0 ? ' #next-action' : ''}`, '- [x] done #next-action', '- [ ] other'];
					await app.vault.create(`${dir}/p${String(i).padStart(4, '0')}.md`, lines.join('\n') + '\n');
				}
				await app.vault.create(base, `filters:\n  and:\n    - file.inFolder("${dir}")\nviews:\n  - type: task-progress\n    name: Many\n    progressSort: note\n    tag: next-action\n`);
			},
			MANY,
			MANY_BASE,
			N_MANY,
		);
		// Close the other bases, and let the metadata cache index the new notes before the clock starts.
		await browser.executeObsidian(({ app }) => {
			for (const leaf of app.workspace.getLeavesOfType('bases')) leaf.detach();
		});
		const indexed = async () => browser.executeObsidian(({ app }, dir) => app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(`${dir}/`) && app.metadataCache.getFileCache(f)?.listItems?.length).length, MANY);
		await browser.waitUntil(async () => (await indexed()) === N_MANY, { timeout: 120_000, interval: 500 }).catch(() => undefined);
		const n = await browser.executeObsidian(({ app }, dir) => app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(`${dir}/`) && app.metadataCache.getFileCache(f)?.listItems?.length).length, MANY);
		expect(n).toBe(N_MANY);
		await browser.executeObsidian(() => {
			const w = window as unknown as { __btpGap: number; __btpLast: number; __btpTimer: number };
			w.__btpGap = 0;
			w.__btpLast = performance.now();
			w.__btpTimer = window.setInterval(() => {
				const now = performance.now();
				w.__btpGap = Math.max(w.__btpGap, now - w.__btpLast);
				w.__btpLast = now;
			}, 20);
		});
		const t0 = Date.now();
		await obsidianPage.openFile(MANY_BASE);
		const s = await waitState(MANY, (x) => x.paths.length === 200, 60_000);
		const openMs = Date.now() - t0;
		expect(s.info).toBe(`Showing 200 of ${N_MANY} notes. Pro shows every note. Counting only tasks tagged #next-action.`);
		// "progressSort: note" in the base file is read back, so the rows sort by note name.
		expect(s.paths.slice(0, 3)).toEqual([`${MANY}/p0000.md`, `${MANY}/p0001.md`, `${MANY}/p0002.md`]);
		expect(s.cells[`${MANY}/p0000.md`]).toEqual(['p0000', '1', '1', '2', '50%', '', '0', 'step 0']);
		expect(s.cells[`${MANY}/p0001.md`]).toEqual(['p0001', '0', '1', '1', '100%', '', '0', '']);

		// Scroll down, change one note, and check that the update keeps the scroll position.
		const scroll = await browser.executeObsidian(async ({ app }, id, dir) => {
			interface V {
				rootEl: HTMLElement;
				notes: { file: { path: string } }[];
			}
			const p = (app as unknown as { plugins: { plugins: Record<string, { progressViews: Set<V> }> } }).plugins.plugins[id]!;
			const v = [...p.progressViews].find((x) => x.rootEl.isConnected && x.notes.some((nn) => nn.file.path.startsWith(`${dir}/`)))!;
			let el: HTMLElement | null = v.rootEl;
			while (el && el.scrollHeight <= el.clientHeight + 1) el = el.parentElement;
			if (!el) return { before: -1, after: -1, cell: '' };
			el.scrollTop = 1500;
			const before = el.scrollTop;
			await app.vault.modify(app.vault.getFileByPath(`${dir}/p0006.md`)!, '# Project 6\n- [ ] new step #next-action\n- [x] done #next-action\n');
			const deadline = performance.now() + 10000;
			let cell = '';
			while (performance.now() < deadline) {
				cell = v.rootEl.querySelector<HTMLElement>(`tr[data-path="${dir}/p0006.md"] td.btp-col-next`)?.textContent ?? '';
				if (cell === 'new step') break;
				await new Promise((r) => setTimeout(r, 50));
			}
			return { before, after: el.scrollTop, cell };
		}, pluginId, MANY);
		expect(scroll.before).toBeGreaterThan(0);
		expect(scroll.cell).toBe('new step');
		expect(scroll.after).toBe(scroll.before);

		const gap = await browser.executeObsidian(() => {
			const w = window as unknown as { __btpGap: number; __btpTimer: number };
			window.clearInterval(w.__btpTimer);
			return w.__btpGap;
		});
		console.log(`[next-task 1000 notes] open to 200 rows ${openMs} ms, longest main thread gap ${Math.round(gap)} ms`);
		expect(openMs).toBeLessThan(30_000);
		expect(gap).toBeLessThan(1000);
	});
});
