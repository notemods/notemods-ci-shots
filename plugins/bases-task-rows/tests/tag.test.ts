import { describe, expect, it } from 'vitest';
import vectors from './vectors/bases-task-rows.json';
import { App, BasesEntry, BasesQueryResult, BasesViewConfig } from 'obsidian-test-mocks/obsidian';
import BasesTaskRowsPlugin from '../src/main';
import { arrangeProgress, hasFilterTag, nextTaskOf, noteProgress, noteTagProgress, parseTagFilter, progressOf, type ProgressRow } from '../src/progress';
import { NEXT_TASK_COLUMN, PROGRESS_COLUMNS, PROGRESS_VIEW_TYPE, TaskProgressView } from '../src/progress-view';
import { parseTaskLine, type TaskInfo } from '../src/task';
import manifest from '../manifest.json';

// 1.5.0: "Count only tasks with tag" and the Next task column of the Task progress view (forum 103074 post 6).

describe('tag vectors (packages/spec/vectors/bases-task-rows.json)', () => {
	const cases = vectors.cases.filter((c) => c.fn === 'noteTagProgress');
	it('has the 21 tag cases', () => expect(cases.length).toBe(21));
	for (const c of cases) {
		it(c.name, () => {
			expect(noteTagProgress(...(c.args as [string, string, string]))).toEqual(c.expected);
		});
	}
});

const tasks = (...lines: string[]): TaskInfo[] => lines.map((l) => parseTaskLine(l)!);

describe('progressOf with a tag fixture', () => {
	// The note has the tag in its frontmatter. Only the task lines below are tasks of the note.
	const FIXTURE = '---\ntags: [next-action]\n---\n# Project\n- [ ] call Ana #next-action 📅 2026-10-20\n- [ ] buy paint\n- [x] mail Bo #next-action\n- [-] old idea #next-action\n- [ ] plan #next-action\n';
	const fixtureTasks = () => {
		const lines = FIXTURE.split('\n');
		return lines.map((l) => parseTaskLine(l)).filter((t): t is TaskInfo => t !== null);
	};

	it('counts only tasks with the tag in the task text', () => {
		expect(progressOf(fixtureTasks(), '2026-10-26', ['next-action'])).toEqual({ open: 2, done: 1, cancelled: 1, total: 3, percent: 33, nextDue: '2026-10-20', overdue: 1 });
	});

	it('a tag in the frontmatter of the note is not a task tag', () => {
		const r = noteTagProgress('---\ntags: [next-action]\n---\n- [ ] buy paint\n', '2026-10-26', 'next-action');
		expect(r).toMatchObject({ open: 0, total: 0, nextTask: null, any: 1 });
	});

	it('a completed tagged task is done, not open, and never the next task', () => {
		const t = tasks('- [x] call #next-action', '- [X] mail #next-action');
		expect(progressOf(t, '2026-10-26', ['next-action'])).toMatchObject({ open: 0, done: 2, total: 2 });
		expect(nextTaskOf(t, ['next-action'])).toBeNull();
	});

	it('a cancelled tagged task follows the old rule: not open, done or total, and not the next task', () => {
		const t = tasks('- [-] call #next-action');
		expect(progressOf(t, '2026-10-26', ['next-action'])).toMatchObject({ open: 0, done: 0, cancelled: 1, total: 0, percent: null });
		expect(nextTaskOf(t, ['next-action'])).toBeNull();
	});

	it('the next task is the first open matching task in file order', () => {
		expect(nextTaskOf(fixtureTasks(), ['next-action'])).toBe('call Ana');
		expect(nextTaskOf(tasks('- [/] doing #na', '- [ ] later #na'), ['na'])).toBe('doing');
	});

	it('an empty filter keeps the old counts for every note of the old vectors', () => {
		for (const c of vectors.cases.filter((x) => x.fn === 'noteProgress')) {
			const [content, today] = c.args as [string, string];
			const { nextTask, any, ...rest } = noteTagProgress(content, today, '');
			expect(rest).toEqual(noteProgress(content, today));
			expect(nextTask).toBeNull();
			expect(any).toBe(rest.total);
		}
		const t = fixtureTasks();
		expect(progressOf(t, '2026-10-26', [])).toEqual(progressOf(t, '2026-10-26'));
	});
});

describe('tag text rules', () => {
	it('"#" is optional, case is ignored, commas and spaces separate tags, repeats go', () => {
		expect(parseTagFilter('#Next-Action')).toEqual(['next-action']);
		expect(parseTagFilter(' #a, b  #A ,c ')).toEqual(['a', 'b', 'c']);
		expect(parseTagFilter('')).toEqual([]);
		expect(parseTagFilter('#')).toEqual([]);
		expect(parseTagFilter('##x/')).toEqual(['x']);
	});

	it('a parent filter matches nested tags; a nested filter does not match its parent or a longer name', () => {
		expect(hasFilterTag(['next/action'], ['next'])).toBe(true);
		expect(hasFilterTag(['Next/Action/Call'], ['next/action'])).toBe(true);
		expect(hasFilterTag(['next'], ['next/action'])).toBe(false);
		expect(hasFilterTag(['next-action'], ['next'])).toBe(false);
		expect(hasFilterTag(['nextaction'], ['next'])).toBe(false);
		expect(hasFilterTag([], ['next'])).toBe(false);
	});
});

describe('arrangeProgress with a tag', () => {
	const row = (note: string, content: string, tag = 'na'): ProgressRow => {
		const p = noteTagProgress(content, '2026-10-26', tag);
		return { path: `P/${note}.md`, note, progress: p, any: p.any, nextTask: p.nextTask };
	};
	const rows = [row('A', '- [ ] call #na\n'), row('B', '- [ ] paint\n'), row('Empty', 'text\n'), row('C', '- [x] done #na\n')];
	const names = (o: Partial<Parameters<typeof arrangeProgress>[1]>) => arrangeProgress(rows, { sort: 'note', descending: false, showEmpty: false, limit: Infinity, ...o }).rows.map((r) => r.note);

	it('"Show notes without tasks" still means notes with no tasks at all, so a project without the tag stays', () => {
		expect(names({})).toEqual(['A', 'B', 'C']);
		expect(names({ showEmpty: true })).toEqual(['A', 'B', 'C', 'Empty']);
	});

	it('"Only notes without a next task" keeps the notes whose Next task cell is empty', () => {
		expect(names({ onlyWithoutNext: true })).toEqual(['B', 'C']);
		expect(names({ onlyWithoutNext: true, showEmpty: true })).toEqual(['B', 'C', 'Empty']);
	});
});

const FILES = {
	'P/A.md': '# A\n- [ ] call #next-action\n- [ ] buy paint\n',
	'P/B.md': '---\ntags: [next-action]\n---\n- [ ] buy paint\n- [x] plan\n',
	'P/C.md': '- [ ] mail #waiting\n',
	'P/None.md': 'no tasks\n',
};

async function setup(files: Record<string, string> = FILES, options: Record<string, unknown> = {}) {
	const app = App.createConfigured__({ files });
	const plugin = new BasesTaskRowsPlugin(app as never, manifest as never);
	await plugin.onload();
	const reg = (plugin as unknown as { basesViewRegistrations__: Map<string, { factory: (c: unknown, el: HTMLElement) => TaskProgressView }> }).basesViewRegistrations__.get(PROGRESS_VIEW_TYPE)!;
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
	const pro = (on: boolean) => {
		(plugin.pro as unknown as { isPro: () => boolean }).isPro = () => on;
		plugin.refreshViews();
	};
	return { app, plugin, view, el, config: v.config, pro };
}

const cells = (el: HTMLElement) => Object.fromEntries(Array.from(el.querySelectorAll<HTMLElement>('tr.btp-row')).map((tr) => [tr.dataset.path, Array.from(tr.querySelectorAll('td')).map((td) => td.textContent)]));
const heads = (el: HTMLElement) => Array.from(el.querySelectorAll('thead th')).map((th) => th.textContent);

describe('TaskProgressView with "Count only tasks with tag"', () => {
	it('an empty tag option keeps the seven old columns and the old info line', async () => {
		const { el } = await setup(FILES, { tag: '' });
		expect(heads(el)).toEqual([...PROGRESS_COLUMNS]);
		expect(el.querySelector('.btr-info')!.textContent).toBe('3 notes');
		expect(el.querySelector('td.btp-col-next')).toBeNull();
	});

	it('note A shows Open 1 and Next task "call"; note B shows 0 and an empty cell', async () => {
		const { el } = await setup(FILES, { tag: '#next-action', sort: 'note' });
		expect(heads(el)).toEqual([...PROGRESS_COLUMNS, NEXT_TASK_COLUMN]);
		const c = cells(el);
		expect(c['P/A.md']).toEqual(['A', '1', '0', '1', '0%', '', '0', 'call']);
		expect(c['P/B.md']).toEqual(['B', '0', '0', '0', '', '', '0', '']);
		expect(el.querySelector('.btr-info')!.textContent).toBe('3 notes. Counting only tasks tagged #next-action.');
	});

	it('without Pro a second tag is not counted and the info line says so; Pro counts any of the tags', async () => {
		const { el, pro } = await setup(FILES, { tag: 'next-action, waiting', sort: 'note' });
		expect(cells(el)['P/C.md']!.slice(1, 2)).toEqual(['0']);
		expect(el.querySelector('.btr-info')!.textContent).toContain('Several tags are a pro feature, so #waiting is not counted.');
		pro(true);
		expect(cells(el)['P/C.md']).toEqual(['C', '1', '0', '1', '0%', '', '0', 'mail']);
		expect(el.querySelector('.btr-info')!.textContent).toBe('3 notes. Counting only tasks tagged #next-action or #waiting.');
	});

	it('"Only notes without a next task" works with Pro and has no effect without Pro', async () => {
		const { el, view, pro } = await setup(FILES, { tag: 'next-action', onlyWithoutNext: true, sort: 'note' });
		expect(view.shownPaths()).toEqual(['P/A.md', 'P/B.md', 'P/C.md']);
		expect(el.querySelector('.btr-info')!.textContent).toContain('Only notes without a next task is a pro feature');
		pro(true);
		expect(view.shownPaths()).toEqual(['P/B.md', 'P/C.md']);
	});

	it('the toggle without a tag changes nothing', async () => {
		const { view, pro } = await setup(FILES, { onlyWithoutNext: true, sort: 'note' });
		pro(true);
		expect(view.shownPaths()).toEqual(['P/A.md', 'P/B.md', 'P/C.md']);
	});

	it('an edit of the tagged task text updates the Next task cell; a tick empties it', async () => {
		const { app, el } = await setup(FILES, { tag: 'next-action' });
		const a = app.vault.getFileByPath('P/A.md')!;
		await app.vault.modify(a, '# A\n- [ ] email Ana #next-action\n- [ ] buy paint\n');
		app.metadataCache.trigger('changed', a, '', {} as never);
		await new Promise((r) => setTimeout(r, 300));
		expect(cells(el)['P/A.md']![7]).toBe('email Ana');
		await app.vault.modify(a, '# A\n- [x] email Ana #next-action\n- [ ] buy paint\n');
		app.metadataCache.trigger('changed', a, '', {} as never);
		await new Promise((r) => setTimeout(r, 300));
		expect(cells(el)['P/A.md']!.slice(1)).toEqual(['0', '1', '1', '100%', '', '0', '']);
	});

	it('text with HTML stays text in the Next task cell', async () => {
		const { el } = await setup({ 'P/X.md': '- [ ] <img src=x onerror=alert(1)> #na\n' }, { tag: 'na' });
		const td = el.querySelector('td.btp-col-next')!;
		expect(td.textContent).toBe('<img src=x onerror=alert(1)>');
		expect(td.querySelector('img')).toBeNull();
	});

	it('1,000 notes with a tag render in under 1 second in the mock app', async () => {
		const files: Record<string, string> = {};
		for (let i = 0; i < 1000; i++) files[`n/${String(i).padStart(4, '0')}.md`] = `- [ ] t${i} ${i % 2 ? '#next-action' : ''}\n- [x] d\n`;
		const { el, view, pro } = await setup(files, { tag: 'next-action', sort: 'note' });
		expect(view.shownPaths().length).toBe(200);
		pro(true);
		const t0 = performance.now();
		view.render();
		expect(performance.now() - t0).toBeLessThan(1000);
		expect(view.shownPaths().length).toBe(1000);
		expect(el.querySelectorAll('td.btp-col-next').length).toBe(1000);
	});
});

describe('Sort by key', () => {
	it('the Task progress view reads progressSort, and the old key sort only when progressSort is missing', async () => {
		const { view, config } = await setup(FILES, { progressSort: 'note', descending: true });
		expect(view.shownPaths()).toEqual(['P/C.md', 'P/B.md', 'P/A.md']);
		config.set('sort', 'open');
		view.render();
		expect(view.shownPaths()).toEqual(['P/C.md', 'P/B.md', 'P/A.md']);
		const old = await setup(FILES, { sort: 'note', descending: true });
		expect(old.view.shownPaths()).toEqual(['P/C.md', 'P/B.md', 'P/A.md']);
	});

	it('the view options and new bases use progressSort and rowSort, never the Bases key sort', async () => {
		const { progressViewOptions } = await import('../src/progress-view');
		const { viewOptions } = await import('../src/view');
		const { taskBaseText } = await import('../src/main');
		const keys = [...progressViewOptions(), ...viewOptions()].flatMap((o) => ('items' in o ? o.items : [o])).map((o) => o.key);
		expect(keys).toContain('progressSort');
		expect(keys).toContain('rowSort');
		expect(keys).not.toContain('sort');
		expect(taskBaseText('P')).not.toMatch(/^\s+sort:/m);
	});
});
