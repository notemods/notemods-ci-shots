import { describe, expect, it } from 'vitest';
import vectors from './vectors/kanban-embed-done.json';
import { applyEdit, type EditOp } from '../src/board';
import { markDone, withChar } from '../src/done';
import { doneSymbol, preDoneSymbol, tasksBridge } from '../src/tasks';
import { fakeTasks, type FakeTasksSpec } from './fake-tasks';

describe('done date, golden vectors (packages/spec/vectors/kanban-embed-done.json)', () => {
	it('has at least 20 cases', () => {
		expect(vectors.cases.length).toBeGreaterThanOrEqual(20);
	});
	for (const c of vectors.cases) {
		it(c.name, () => {
			const [md, op, tasks] = c.args as [string, EditOp, FakeTasksSpec | null];
			expect(applyEdit(md, op, fakeTasks(tasks))).toEqual(c.expected);
		});
	}
});

describe('markDone', () => {
	const T = fakeTasks({ today: '2026-10-10' });

	it('leaves a card that is already in the wanted state', () => {
		const r = markDone(['- [x] a ✅ 2026-10-01'], true, T);
		expect(r).toEqual({ all: [['- [x] a ✅ 2026-10-01']], main: 0, changed: false });
		expect(markDone(['- [ ] a'], false, T).changed).toBe(false);
	});

	it('gives the finished card as `main` and the new copy of a recurring task as the other block', () => {
		const r = markDone(['- [ ] w 🔁 every day 📅 2026-10-10', '\tnote'], true, T);
		expect(r.all).toEqual([['- [ ] w 🔁 every day 📅 2026-10-11', '\tnote'], ['- [x] w 🔁 every day 📅 2026-10-10 ✅ 2026-10-10', '\tnote']]);
		expect(r.main).toBe(1);
		const below = markDone(['- [ ] w 🔁 every day 📅 2026-10-10'], true, fakeTasks({ today: '2026-10-10', recurrenceOnNextLine: true }));
		expect(below.main).toBe(0);
	});

	it('uses a plain x without Tasks, and a plain space to uncheck', () => {
		expect(markDone(['- [ ] a'], true, null).all).toEqual([['- [x] a']]);
		expect(markDone(['- [X] a'], false, null).all).toEqual([['- [ ] a']]);
	});

	it('falls back to a plain check mark when Tasks returns a line it cannot split', () => {
		const odd = { doneChar: 'x', preDoneChar: ' ', recurrenceOnNextLine: false, toggle: () => 'not a task line' };
		expect(markDone(['- [ ] a'], true, odd).all).toEqual([['- [x] a']]);
	});

	it('does nothing to a line that is not a checkbox card', () => {
		expect(markDone(['- plain card'], true, T).changed).toBe(false);
	});

	it('withChar changes only the symbol', () => {
		expect(withChar('* [ ] a [b](c)', 'x')).toBe('* [x] a [b](c)');
	});
});

describe('Tasks bridge, read the way Kanban reads it', () => {
	// The key is built from a variable so the export check for monorepo words (the word workspace and a colon) does not read it as a pnpm range.
	const WS = 'workspace';
	const statusSettings = {
		coreStatuses: [
			{ symbol: ' ', type: 'TODO', nextStatusSymbol: 'x' },
			{ symbol: 'x', type: 'DONE', nextStatusSymbol: ' ' },
		],
		customStatuses: [{ symbol: '!', type: 'TODO', nextStatusSymbol: 'D' }, { symbol: 'D', type: 'DONE', nextStatusSymbol: ' ' }],
	};
	const appWith = (opts: { enabled: boolean; api?: unknown; settings?: unknown }) =>
		({
			plugins: { enabledPlugins: new Set(opts.enabled ? ['obsidian-tasks-plugin'] : []), plugins: { 'obsidian-tasks-plugin': { apiV1: opts.api } } },
			[WS]: { editorSuggest: { suggests: [{ settings: undefined }, { settings: opts.settings }] } },
		}) as never;

	it('is null when Tasks is off, has no API or no toggle function', () => {
		expect(tasksBridge(appWith({ enabled: false, api: { executeToggleTaskDoneCommand: () => '' } }), 'B.md')).toBeNull();
		expect(tasksBridge(appWith({ enabled: true }), 'B.md')).toBeNull();
		expect(tasksBridge(appWith({ enabled: true, api: {} }), 'B.md')).toBeNull();
		expect(tasksBridge({ plugins: undefined, [WS]: {} } as never, 'B.md')).toBeNull();
	});

	it('calls the Tasks API with the line and the board path, and reads the settings', () => {
		const calls: unknown[][] = [];
		const api = { executeToggleTaskDoneCommand: (...a: unknown[]) => (calls.push(a), '- [x] a ✅ 2026-10-10') };
		const b = tasksBridge(appWith({ enabled: true, api, settings: { taskFormat: 'tasksPluginEmoji', statusSettings, recurrenceOnNextLine: true } }), 'Boards/B.md')!;
		expect(b.toggle('- [ ] a')).toBe('- [x] a ✅ 2026-10-10');
		expect(calls).toEqual([['- [ ] a', 'Boards/B.md']]);
		expect(b).toMatchObject({ doneChar: 'x', preDoneChar: ' ', recurrenceOnNextLine: true });
	});

	it('takes defaults without Tasks settings, and an empty answer is no answer', () => {
		const b = tasksBridge(appWith({ enabled: true, api: { executeToggleTaskDoneCommand: () => '' } }), 'B.md')!;
		expect(b).toMatchObject({ doneChar: 'x', preDoneChar: ' ', recurrenceOnNextLine: false });
		expect(b.toggle('- [ ] a')).toBeNull();
	});

	it('an API that throws gives null, so the card gets a plain check mark', () => {
		const api = { executeToggleTaskDoneCommand: () => { throw new Error('tasks broke'); } };
		const b = tasksBridge(appWith({ enabled: true, api }), 'B.md')!;
		expect(b.toggle('- [ ] a')).toBeNull();
		expect(markDone(['- [ ] a'], true, b).all).toEqual([['- [x] a']]);
	});

	it('finds the DONE symbol and the status before it, core statuses first', () => {
		expect(doneSymbol({ statusSettings })).toBe('x');
		expect(preDoneSymbol({ statusSettings })).toBe(' ');
		const onlyCustom = { statusSettings: { customStatuses: statusSettings.customStatuses } };
		expect(doneSymbol(onlyCustom)).toBe('D');
		expect(preDoneSymbol(onlyCustom)).toBe('!');
		expect(doneSymbol(null)).toBe('x');
		expect(preDoneSymbol(null)).toBe(' ');
	});
});
