import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId } from './load';
import { DIR, waitRows } from './rows';

// The Task progress view in a real Obsidian: one row per project note, no writes while it opens, sorts and
// updates, and new counts within 2 seconds after a tick in the Task rows view of the same base.
const BASE = `${DIR}/Project progress.base`;
const SITE = `${DIR}/Projects/Website relaunch.md`;

interface ProgressState {
	paths: string[];
	cells: Record<string, string[]>;
	info: string;
}

/** State of the connected Task progress view, or null when there is none yet. */
async function progressState(): Promise<ProgressState | null> {
	return browser.executeObsidian(({ app }, id) => {
		interface V {
			rootEl: HTMLElement;
			shownPaths(): string[];
		}
		const p = (app as unknown as { plugins: { plugins: Record<string, { progressViews?: Set<V> }> } }).plugins.plugins[id];
		const v = [...(p?.progressViews ?? [])].find((x) => x.rootEl.isConnected);
		if (!v) return null;
		const cells: Record<string, string[]> = {};
		for (const tr of Array.from(v.rootEl.querySelectorAll<HTMLElement>('tr.btp-row'))) cells[tr.dataset.path ?? ''] = Array.from(tr.querySelectorAll('td')).map((td) => td.textContent ?? '');
		return { paths: v.shownPaths(), cells, info: v.rootEl.querySelector('.btr-info')?.textContent ?? '' };
	}, pluginId);
}

async function waitProgress(test: (s: ProgressState) => boolean, timeout = 15000): Promise<ProgressState> {
	let last: ProgressState | null = null;
	await browser.waitUntil(
		async () => {
			last = await progressState();
			return last !== null && test(last);
		},
		{ interval: 200, timeout, timeoutMsg: `Task progress view not as expected: ${JSON.stringify(last)}` },
	);
	return last!;
}

/** Raw text of every Markdown note in the vault, by path. */
async function allNotes(): Promise<Record<string, string>> {
	return browser.executeObsidian(async ({ app }) => {
		const out: Record<string, string> = {};
		for (const f of app.vault.getMarkdownFiles()) out[f.path] = await app.vault.adapter.read(f.path);
		return out;
	});
}

describe(`${pluginId} Task progress view`, function () {
	let notesBefore: Record<string, string> = {};

	it('shows one row per project note with open, done, total, progress, next due and overdue', async function () {
		notesBefore = await allNotes();
		await obsidianPage.openFile(BASE);
		const s = await waitProgress((x) => x.paths.length === 10);
		expect(s.info).toBe('10 notes');
		// Website relaunch: 3 open and 2 done tasks; the task inside the code block does not count.
		expect(s.cells[SITE]!.slice(0, 5)).toEqual(['Website relaunch', '3', '2', '5', '40%']);
		expect(s.cells[SITE]![5]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it('never writes to a note while it opens, sorts and updates', async function () {
		const writes = await browser.executeObsidian(async ({ app }, id) => {
			interface V {
				rootEl: HTMLElement;
				config: { set(k: string, v: unknown): void };
				render(): void;
				reload(): Promise<void>;
				schedule(d?: number): void;
			}
			const p = (app as unknown as { plugins: { plugins: Record<string, { progressViews: Set<V> }> } }).plugins.plugins[id]!;
			const v = [...p.progressViews].find((x) => x.rootEl.isConnected)!;
			const vault = app.vault as unknown as Record<string, (...a: unknown[]) => unknown>;
			const seen: string[] = [];
			const saved: Array<[string, (...a: unknown[]) => unknown]> = [];
			for (const m of ['modify', 'process', 'create', 'append', 'modifyBinary']) {
				const orig = vault[m]!;
				saved.push([m, orig]);
				vault[m] = (...a: unknown[]) => {
					// Bases saves view options in the .base file. Only a write to a note counts here.
					const target = typeof a[0] === 'string' ? a[0] : ((a[0] as { path?: string } | undefined)?.path ?? '');
					if (target.endsWith('.md')) seen.push(`${m} ${target}`);
					return orig.apply(app.vault, a);
				};
			}
			try {
				for (const sort of ['progress', 'open', 'due', 'note']) {
					for (const desc of [true, false]) {
						v.config.set('sort', sort);
						v.config.set('descending', desc);
						v.render();
					}
				}
				v.config.set('showEmpty', true);
				v.schedule(0);
				await new Promise((r) => setTimeout(r, 400));
				await v.reload();
				v.config.set('showEmpty', false);
				v.config.set('sort', 'progress');
				v.config.set('descending', false);
				await v.reload();
			} finally {
				for (const [m, f] of saved) vault[m] = f;
			}
			return seen;
		}, pluginId);
		expect(writes).toEqual([]);
		expect(await allNotes()).toEqual(notesBefore);
	});

	it('shows the new counts within 2 seconds after a tick in the Task rows view of the same base', async function () {
		await browser.executeObsidian(async ({ app }, file) => {
			const leaf = app.workspace.getLeaf('split', 'vertical');
			await leaf.setViewState({ type: 'bases', state: { file, viewName: 'Tasks' }, active: true });
			app.workspace.setActiveLeaf(leaf, { focus: true });
		}, BASE);
		await waitRows(50);
		const before = await progressState();
		expect(before?.cells[SITE]?.slice(1, 5)).toEqual(['3', '2', '5', '40%']);
		const ms = await browser.executeObsidian(async ({ app }, id, site) => {
			interface V {
				rootEl: HTMLElement;
			}
			const p = (app as unknown as { plugins: { plugins: Record<string, { progressViews: Set<V> }> } }).plugins.plugins[id]!;
			const v = [...p.progressViews].find((x) => x.rootEl.isConnected)!;
			const tr = Array.from(document.querySelectorAll<HTMLElement>('.workspace-leaf.mod-active tr.btr-row')).find((x) => x.dataset.id === `${site}#11`);
			const box = tr?.querySelector<HTMLInputElement>('input.task-list-item-checkbox');
			if (!box) return -1;
			const t0 = performance.now();
			box.click();
			const counts = () => Array.from(v.rootEl.querySelectorAll<HTMLElement>('tr.btp-row')).find((x) => x.dataset.path === site)?.querySelectorAll('td');
			while (performance.now() - t0 < 5000) {
				const td = counts();
				if (td && td[1]?.textContent === '2' && td[2]?.textContent === '3' && td[4]?.textContent === '60%') return performance.now() - t0;
				await new Promise((r) => setTimeout(r, 25));
			}
			return -2;
		}, pluginId, SITE);
		expect(ms).toBeGreaterThan(0);
		expect(ms).toBeLessThan(2000);
		const after = await progressState();
		expect(after?.cells[SITE]?.slice(1, 5)).toEqual(['2', '3', '5', '60%']);
	});

	it('opens the note when a row is clicked', async function () {
		const path = await browser.executeObsidian(async ({ app }, id, site) => {
			interface V {
				rootEl: HTMLElement;
			}
			const p = (app as unknown as { plugins: { plugins: Record<string, { progressViews: Set<V> }> } }).plugins.plugins[id]!;
			const v = [...p.progressViews].find((x) => x.rootEl.isConnected)!;
			Array.from(v.rootEl.querySelectorAll<HTMLElement>('tr.btp-row'))
				.find((x) => x.dataset.path === site)!
				.querySelector<HTMLElement>('a.btp-note')!
				.click();
			await new Promise((r) => setTimeout(r, 500));
			return app.workspace.getActiveFile()?.path ?? '';
		}, pluginId, SITE);
		expect(path).toBe(SITE);
	});
});
