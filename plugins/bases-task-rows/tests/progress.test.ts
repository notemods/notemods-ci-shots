import { describe, expect, it } from 'vitest';
import vectors from './vectors/bases-task-rows.json';
import { App, BasesEntry, BasesQueryResult, BasesViewConfig } from 'obsidian-test-mocks/obsidian';
import BasesTaskRowsPlugin from '../src/main';
import { arrangeProgress, noteProgress, progressOf, taskLinesOutsideCode, wholePercent, type ProgressRow } from '../src/progress';
import { PROGRESS_COLUMNS, PROGRESS_VIEW_TYPE, TaskProgressView, progressViewOptions } from '../src/progress-view';
import { localToday } from '../src/view';
import manifest from '../manifest.json';

describe('progress vectors (packages/spec/vectors/bases-task-rows.json)', () => {
	const cases = vectors.cases.filter((c) => c.fn === 'noteProgress');
	it('has the 5 acceptance cases', () => expect(cases.length).toBe(5));
	for (const c of cases) {
		it(c.name, () => {
			expect(noteProgress(...(c.args as [string, string]))).toEqual(c.expected);
		});
	}
});

describe('progress counts', () => {
	it('criterion 1: x and X are done, 2 of 3 is 67%', () => {
		expect(noteProgress('- [ ] a\n- [x] b\n- [X] c\n', '2026-10-10')).toMatchObject({ open: 1, done: 2, total: 3, percent: 67, progress: '67%' });
	});

	it('criterion 2: a cancelled task is not open, done or total', () => {
		expect(noteProgress('- [-] a\n- [ ] b\n', '2026-10-10')).toMatchObject({ open: 1, done: 0, total: 1, cancelled: 1, progress: '0%' });
	});

	it('every other status counts as open', () => {
		expect(noteProgress('- [/] a\n- [>] b\n- [?] c\n- [x] d\n', '2026-10-10')).toMatchObject({ open: 3, done: 1, total: 4, percent: 25 });
	});

	it('criterion 3: a task in a fenced code block gives total 0 and an empty progress cell', () => {
		expect(noteProgress('```\n- [ ] code\n```\n~~~md\n- [x] code\n~~~\n', '2026-10-10')).toMatchObject({ total: 0, percent: null, progress: '' });
		expect(taskLinesOutsideCode('- [ ] a\n````\n```\n- [ ] in code\n````\n- [ ] b\r\n> ```\n> - [ ] quoted code\n> ```\n')).toEqual([0, 5]);
	});

	it('uses the task lines of the metadata cache when it has them', () => {
		expect(noteProgress('- [ ] a\n- [x] b\n', '2026-10-10', [1])).toMatchObject({ open: 0, done: 1, total: 1, percent: 100 });
	});

	it('criterion 4: next due is the earliest due date of an open task only', () => {
		const p = progressOf(
			[
				{ status: 'x', dates: { due: '2026-10-01' } },
				{ status: '-', dates: { due: '2026-10-02' } },
				{ status: ' ', dates: { due: '2026-10-20', scheduled: '2026-10-03' } },
				{ status: ' ', dates: { due: '2026-10-15' } },
			],
			'2026-10-10',
		);
		expect(p.nextDue).toBe('2026-10-15');
		expect(progressOf([{ status: 'x', dates: { due: '2026-10-01' } }], '2026-10-10').nextDue).toBeNull();
	});

	it('criterion 5: overdue counts open tasks due before today; due today is not overdue', () => {
		const p = progressOf(
			[
				{ status: ' ', dates: { due: '2026-10-09' } },
				{ status: ' ', dates: { due: '2026-10-10' } },
				{ status: 'x', dates: { due: '2026-10-01' } },
				{ status: '-', dates: { due: '2026-10-01' } },
			],
			'2026-10-10',
		);
		expect(p.overdue).toBe(1);
	});

	it('the whole percent reads 100 only when every task is done and 0 only when none is', () => {
		expect(wholePercent(199, 200)).toBe(99);
		expect(wholePercent(1, 300)).toBe(1);
		expect(wholePercent(0, 5)).toBe(0);
		expect(wholePercent(5, 5)).toBe(100);
		expect(wholePercent(0, 0)).toBeNull();
	});
});

const row = (note: string, tasks: string, today = '2026-10-10'): ProgressRow => ({ path: `P/${note}.md`, note, progress: noteProgress(tasks, today) });

describe('arrangeProgress', () => {
	const rows = [row('Beta', '- [x] a\n- [ ] b 📅 2026-10-12\n'), row('alpha', '- [ ] a 📅 2026-10-11\n- [ ] b\n- [ ] c\n'), row('Empty', 'no tasks\n'), row('Gamma', '- [x] a\n')];
	const names = (o: Partial<Parameters<typeof arrangeProgress>[1]>) => arrangeProgress(rows, { sort: 'progress', descending: false, showEmpty: false, limit: Infinity, ...o }).rows.map((r) => r.note);

	it('criterion 6: without "Show notes without tasks" a note with total 0 has no row', () => {
		expect(names({})).not.toContain('Empty');
		expect(names({ showEmpty: true })).toContain('Empty');
		expect(arrangeProgress([row('Cancelled', '- [-] a\n')], { sort: 'note', descending: false, showEmpty: false, limit: Infinity }).rows).toEqual([]);
	});

	it('sorts by progress, open tasks, next due and note name, and reverses with "Sort highest first"', () => {
		expect(names({ sort: 'progress' })).toEqual(['alpha', 'Beta', 'Gamma']);
		expect(names({ sort: 'progress', descending: true })).toEqual(['Gamma', 'Beta', 'alpha']);
		expect(names({ sort: 'open', descending: true })).toEqual(['alpha', 'Beta', 'Gamma']);
		expect(names({ sort: 'due' })).toEqual(['alpha', 'Beta', 'Gamma']);
		expect(names({ sort: 'due', descending: true })).toEqual(['Beta', 'alpha', 'Gamma']);
		expect(names({ sort: 'note' })).toEqual(['alpha', 'Beta', 'Gamma']);
		expect(names({ sort: 'note', descending: true, showEmpty: true })).toEqual(['Gamma', 'Empty', 'Beta', 'alpha']);
		// A note without tasks sorts last for progress in both directions.
		expect(names({ sort: 'progress', showEmpty: true }).at(-1)).toBe('Empty');
		expect(names({ sort: 'progress', descending: true, showEmpty: true }).at(-1)).toBe('Empty');
	});

	it('caps the note rows and keeps the first in sort order', () => {
		const many = Array.from({ length: 230 }, (_, i) => row(`n${i}`, '- [ ] a\n'));
		const out = arrangeProgress(many, { sort: 'note', descending: false, showEmpty: false, limit: 200 });
		expect(out.rows.length).toBe(200);
		expect(out.matched).toBe(230);
		expect(out.rows[0]!.note).toBe('n0');
	});
});

const FILES = {
	'P/Alpha.md': '# Alpha\n- [ ] a 📅 2020-01-01\n- [x] b\n- [X] c\n- [-] d\n',
	'P/Beta.md': '## Beta\n- [ ] Call Ana [due:: 2099-10-09]\n```\n- [ ] code\n```\n',
	'P/None.md': 'no tasks here\n',
	'P/Code only.md': '```\n- [ ] code\n- [x] code\n```\n',
};

async function setup(files: Record<string, string> = FILES, options: Record<string, unknown> = {}) {
	const app = App.createConfigured__({ files });
	const plugin = new BasesTaskRowsPlugin(app as never, manifest as never);
	await plugin.onload();
	const reg = (plugin as unknown as { basesViewRegistrations__: Map<string, { name: string; factory: (c: unknown, el: HTMLElement) => TaskProgressView }> }).basesViewRegistrations__.get(PROGRESS_VIEW_TYPE)!;
	const el = document.createElement('div');
	document.body.appendChild(el);
	const view = reg.factory({} as never, el);
	const v = view as unknown as { app: unknown; config: BasesViewConfig; data: BasesQueryResult };
	v.app = app;
	v.config = BasesViewConfig.create__('', PROGRESS_VIEW_TYPE, 'Task progress');
	for (const [k, val] of Object.entries(options)) v.config.set(k, val);
	const result = BasesQueryResult.create__(app, v.config, [], []);
	result.setData__(Object.keys(files).map((p) => BasesEntry.create__({}, app.vault.getFileByPath(p)!)));
	v.data = result;
	view.load();
	await view.reload();
	return { app, plugin, view, el, reg, config: v.config };
}

const cells = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLElement>('tr.btp-row')).map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent));

describe('TaskProgressView in the mock app', () => {
	it('registers "Task progress" next to "Task rows", with the three view options', async () => {
		const { reg } = await setup();
		expect(reg.name).toBe('Task progress');
		expect(progressViewOptions().map((o) => ('key' in o ? o.key : ''))).toEqual(['sort', 'descending', 'showEmpty']);
		expect(progressViewOptions().map((o) => o.displayName)).toEqual(['Sort by', 'Sort highest first', 'Show notes without tasks']);
	});

	it('shows one row per note with tasks and the seven columns', async () => {
		const { el, view } = await setup();
		expect(Array.from(el.querySelectorAll('thead th')).map((th) => th.textContent)).toEqual([...PROGRESS_COLUMNS]);
		expect(view.shownPaths()).toEqual(['P/Beta.md', 'P/Alpha.md']);
		expect(cells(el)).toEqual([
			['Beta', '1', '0', '1', '0%', '2099-10-09', '0'],
			['Alpha', '1', '2', '3', '67%', '2020-01-01', '1'],
		]);
		expect(el.querySelector<HTMLProgressElement>('tr[data-path="P/Alpha.md"] progress')!.getAttribute('value')).toBe('67');
		expect(el.querySelector('.btr-info')!.textContent).toBe('2 notes');
	});

	it('"Show notes without tasks" adds the empty notes with an empty progress cell, and sorts by note name', async () => {
		const { el, view } = await setup(FILES, { showEmpty: true, sort: 'note' });
		expect(view.shownPaths()).toEqual(['P/Alpha.md', 'P/Beta.md', 'P/Code only.md', 'P/None.md']);
		const code = el.querySelector('tr[data-path="P/Code only.md"]')!;
		expect(code.querySelector('progress')).toBeNull();
		expect(code.querySelector('td.btp-col-total')!.textContent).toBe('0');
		expect(code.querySelector('td.btp-col-progress')!.textContent).toBe('');
	});

	it('opens the note on click, and in a new tab on Ctrl or Cmd click', async () => {
		const { app, el } = await setup();
		const calls: unknown[] = [];
		const ws = app.workspace as unknown as { getLeaf: (n?: unknown) => { openFile: (f: { path: string }) => Promise<void> } };
		ws.getLeaf = (n?: unknown) => ({ openFile: async (f) => void calls.push([n, f.path]) });
		const link = el.querySelector<HTMLElement>('tr[data-path="P/Alpha.md"] a.btp-note')!;
		link.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		link.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true, metaKey: true }));
		await new Promise((r) => setTimeout(r, 0));
		expect(calls[0]).toEqual([false, 'P/Alpha.md']);
		expect(calls[1]![0]).toBe('tab');
		expect((calls[1] as unknown[])[1]).toBe('P/Alpha.md');
	});

	it('updates the rows after a note in the base changes, with the 150 ms debounce', async () => {
		const { app, view } = await setup();
		await app.vault.modify(app.vault.getFileByPath('P/Beta.md')!, '- [x] Call Ana\n- [x] Mail Bo\n');
		app.metadataCache.trigger('changed', app.vault.getFileByPath('P/Beta.md')!, '', {} as never);
		await new Promise((r) => setTimeout(r, 50));
		expect(view.notes.find((n) => n.file.path === 'P/Beta.md')!.tasks.length).toBe(1);
		await new Promise((r) => setTimeout(r, 250));
		expect(view.rootEl.querySelector('tr[data-path="P/Beta.md"] td.btp-col-progress')!.textContent).toBe('100%');
	});

	it('criterion 8: never writes to a note while it opens, sorts and updates', async () => {
		const { app, view, config } = await setup(FILES, { showEmpty: true });
		const vault = app.vault as unknown as Record<string, (...a: unknown[]) => unknown>;
		const writes: string[] = [];
		for (const m of ['modify', 'process', 'create', 'append', 'delete', 'trash', 'rename', 'modifyBinary']) {
			const orig = vault[m];
			if (typeof orig !== 'function') continue;
			vault[m] = (...a: unknown[]) => {
				writes.push(m);
				return orig.apply(app.vault, a);
			};
		}
		const before = await Promise.all(Object.keys(FILES).map((p) => app.vault.read(app.vault.getFileByPath(p)!)));
		for (const sort of ['progress', 'open', 'due', 'note']) {
			for (const descending of [false, true]) {
				config.set('sort', sort);
				config.set('descending', descending);
				view.onDataUpdated();
				await view.reload();
			}
		}
		view.rootEl.querySelector<HTMLElement>('tr.btp-row td.btp-col-due')!.click();
		expect(writes).toEqual([]);
		expect(await Promise.all(Object.keys(FILES).map((p) => app.vault.read(app.vault.getFileByPath(p)!)))).toEqual(before);
	});

	it('without Pro caps the note rows at 200 and counts every task of each shown note; Pro shows every note', async () => {
		const files: Record<string, string> = {};
		for (let i = 0; i < 230; i++) files[`n/${String(i).padStart(3, '0')}.md`] = Array.from({ length: 3 }, (_, k) => `- [${k === 0 ? 'x' : ' '}] t${k}`).join('\n') + '\n';
		const { el, view, plugin } = await setup(files, { sort: 'note' });
		expect(view.shownPaths().length).toBe(200);
		expect(el.querySelector('.btr-info')!.textContent).toBe('Showing 200 of 230 notes. Pro shows every note.');
		expect(el.querySelector('tr.btp-row td.btp-col-total')!.textContent).toBe('3');
		(plugin.pro as unknown as { isPro: () => boolean }).isPro = () => true;
		plugin.refreshViews();
		expect(view.shownPaths().length).toBe(230);
	});

	it('marks a past next due date as overdue and uses the local date', async () => {
		const { el } = await setup();
		expect(el.querySelector('tr[data-path="P/Alpha.md"] td.btp-col-due')!.classList.contains('btr-overdue')).toBe(true);
		expect(localToday(new Date(2026, 9, 5, 23, 30))).toBe('2026-10-05');
	});

	it('"Create a task base for the current folder" adds a Task progress view to the new base', async () => {
		const { app, plugin } = await setup();
		await (plugin as unknown as { createTaskBase(): Promise<void> }).createTaskBase();
		const base = app.vault.getFiles().find((f) => f.extension === 'base')!;
		const text = await app.vault.read(base);
		expect(text).toContain('  - type: task-progress\n    name: Task progress\n');
		expect(text).toContain('  - type: task-rows\n    name: Tasks\n');
	});
});
