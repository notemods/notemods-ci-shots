import { describe, expect, it } from 'vitest';
import vectors from './vectors/kanban-embed-swimlanes.json';
import { buildView, parseConfig } from '../src/embed';
import { UNASSIGNED_KEY, describeSwimlane, dropIndex, fieldValue, groupSwimlanes, parseSwimlane, rowOf, rowSuffix, type SwimlaneSpec } from '../src/swimlanes';

/** The function of the golden vectors: rows of a board as {row, count, lanes}. */
function swimlaneRows(md: string, line: string) {
	const spec = parseSwimlane(line);
	if (typeof spec === 'string') throw new Error(spec);
	const view = buildView([{ path: 'B.md', name: 'B', markdown: md }]);
	return groupSwimlanes(view.columns, spec).map((r) => ({
		row: r.title,
		count: r.count,
		lanes: Object.fromEntries(view.columns.map((c, i) => [c.title, r.cells[i]!.map((x) => x.text)])),
	}));
}

describe('swimlane golden vectors (packages/spec/vectors/kanban-embed-swimlanes.json)', () => {
	it('has at least 10 cases', () => {
		expect(vectors.cases.length).toBeGreaterThanOrEqual(10);
	});
	for (const c of vectors.cases) {
		it(c.name, () => {
			const [md, line] = c.args as [string, string];
			expect(swimlaneRows(md, line)).toEqual(c.expected);
		});
	}
	it('every card is in exactly one row: the counts add up to the cards of the board', () => {
		for (const c of vectors.cases) {
			const [md, line] = c.args as [string, string];
			const total = buildView([{ path: 'B.md', name: 'B', markdown: md }]).cards;
			expect(swimlaneRows(md, line).reduce((n, r) => n + r.count, 0)).toBe(total);
		}
	});
});

describe('parseSwimlane', () => {
	it('reads tag, a prefix, a tag list and a field', () => {
		expect(parseSwimlane('tag')).toEqual({ kind: 'tag' });
		expect(parseSwimlane(' Tags ')).toEqual({ kind: 'tag' });
		expect(parseSwimlane('#project/')).toEqual({ kind: 'prefix', prefix: '#project/' });
		expect(parseSwimlane('#now, #next #later')).toEqual({ kind: 'tags', tags: ['#now', '#next', '#later'] });
		expect(parseSwimlane('@{Owner}')).toEqual({ kind: 'field', name: 'owner' });
	});

	it('explains what is wrong', () => {
		expect(parseSwimlane('')).toBe('swimlane must be tag, #tag1, #tag2, #prefix/ or @{field}: ');
		expect(parseSwimlane('owner')).toContain('swimlane must be');
		expect(parseSwimlane('#/')).toContain('swimlane must be');
		expect(parseSwimlane('#a/, #b')).toContain('must be the only item');
		expect(parseSwimlane('@{two words}')).toContain('swimlane must be');
	});

	it('describeSwimlane gives back the line', () => {
		for (const v of ['tag', '#project/', '#now, #next', '@{owner}']) expect(describeSwimlane(parseSwimlane(v) as SwimlaneSpec)).toBe(v);
	});

	it('parseConfig reads the line, also as rows:, and reports a bad value', () => {
		expect(parseConfig('board: A\nswimlane: #project/').swimlane).toEqual({ kind: 'prefix', prefix: '#project/' });
		expect(parseConfig('board: A\nrows: tag').swimlane).toEqual({ kind: 'tag' });
		expect(parseConfig('board: A').swimlane).toBeUndefined();
		const bad = parseConfig('board: A\nswimlane: owner');
		expect(bad.swimlane).toBeUndefined();
		expect(bad.errors).toEqual(['swimlane must be tag, #tag1, #tag2, #prefix/ or @{field}: owner']);
	});
});

describe('fieldValue and rowOf', () => {
	const none = { date: null, time: null };

	it('reads the three field forms and ignores the name case', () => {
		expect(fieldValue({ text: 'a [Owner:: Ana B]', ...none }, 'owner')).toBe('Ana B');
		expect(fieldValue({ text: 'a (owner:: Ana)', ...none }, 'owner')).toBe('Ana');
		expect(fieldValue({ text: 'a\nowner:: Ana', ...none }, 'owner')).toBe('Ana');
		expect(fieldValue({ text: 'a [owner::]', ...none }, 'owner')).toBeNull();
		expect(fieldValue({ text: 'coowner:: x', ...none }, 'owner')).toBeNull();
	});

	it('takes date and time from the card, and escapes the field name', () => {
		expect(fieldValue({ text: 'a', date: '2026-10-14', time: '14:30' }, 'date')).toBe('2026-10-14');
		expect(fieldValue({ text: 'a', date: null, time: '14:30' }, 'time')).toBe('14:30');
		expect(fieldValue({ text: 'a [a.b:: 1]', ...none }, 'a.b')).toBe('1');
		expect(fieldValue({ text: 'a [axb:: 1]', ...none }, 'a.b')).toBeNull();
	});

	it('rowOf finds the row of a card for each kind', () => {
		const card = { text: 'x #Project/Alpha #docs', tags: ['#Project/Alpha', '#docs'], date: null, time: null };
		expect(rowOf(card, { kind: 'tag' })).toEqual({ key: '#project/alpha', title: '#Project/Alpha' });
		expect(rowOf(card, { kind: 'prefix', prefix: '#project/' })).toEqual({ key: '#project/alpha', title: 'Alpha' });
		expect(rowOf(card, { kind: 'tags', tags: ['#docs', '#project'] })).toEqual({ key: '#docs', title: '#docs' });
		expect(rowOf({ ...card, tags: [] }, { kind: 'tag' })).toBeNull();
		expect(rowOf(card, { kind: 'prefix', prefix: '#project/alpha/' })).toBeNull();
	});
});

describe('groupSwimlanes edge cases', () => {
	it('keeps a row per column even when the column has no card of the row', () => {
		const md = '---\nkanban-plugin: board\n---\n\n## A\n\n- [ ] one #x\n\n## B\n\n- [ ] two #y\n';
		const rows = swimlaneRows(md, 'tag');
		expect(rows.map((r) => Object.keys(r.lanes))).toEqual([['A', 'B'], ['A', 'B']]);
	});

	it('a board with no cards has no rows, and an explicit list still shows its rows', () => {
		const md = '---\nkanban-plugin: board\n---\n\n## A\n';
		expect(swimlaneRows(md, 'tag')).toEqual([]);
		expect(swimlaneRows(md, '#a, #b').map((r) => [r.row, r.count])).toEqual([['#a', 0], ['#b', 0]]);
	});

	it('hidden done cards are not in the rows', () => {
		const md = '---\nkanban-plugin: board\n---\n\n## A\n\n- [x] one #x\n- [ ] two #x\n';
		const view = buildView([{ path: 'B.md', name: 'B', markdown: md }], { hideDone: true });
		expect(groupSwimlanes(view.columns, { kind: 'tag' })[0]!.count).toBe(1);
	});

	it('merges the cards of two boards into one row and keeps each board and card index', () => {
		const a = '---\nkanban-plugin: board\n---\n\n## Todo\n\n- [ ] a1 #x\n- [ ] a2 #x\n';
		const b = '---\nkanban-plugin: board\n---\n\n## Todo\n\n- [ ] b1 #x\n';
		const view = buildView([{ path: 'A.md', name: 'A', markdown: a }, { path: 'B.md', name: 'B', markdown: b }]);
		const cell = groupSwimlanes(view.columns, { kind: 'tag' })[0]!.cells[0]!;
		expect(cell.map((c) => [c.board, c.index])).toEqual([[0, 0], [0, 1], [1, 0]]);
	});
});

describe('rowSuffix and dropIndex', () => {
	it('a new card gets the tag or the field of its row, nothing for Unassigned', () => {
		expect(rowSuffix({ kind: 'tag' }, { key: '#a', title: '#a' })).toBe(' #a');
		expect(rowSuffix({ kind: 'tags', tags: ['#a'] }, { key: '#a', title: '#a' })).toBe(' #a');
		expect(rowSuffix({ kind: 'prefix', prefix: '#p/' }, { key: '#p/x', title: 'x' })).toBe(' #p/x');
		expect(rowSuffix({ kind: 'field', name: 'owner' }, { key: 'ana', title: 'Ana' })).toBe(' [owner:: Ana]');
		expect(rowSuffix({ kind: 'field', name: 'date' }, { key: 'd', title: '2026-10-14' })).toBe(' @{2026-10-14}');
		expect(rowSuffix({ kind: 'field', name: 'time' }, { key: 't', title: '14:30' })).toBe(' @@{14:30}');
		expect(rowSuffix({ kind: 'tag' }, { key: UNASSIGNED_KEY, title: 'Unassigned' })).toBe('');
	});

	it('a drop goes in front of the next card of the row, else behind its last card, else to the end of the lane', () => {
		const cell = [{ board: 0, index: 1 }, { board: 0, index: 4 }, { board: 1, index: 0 }];
		expect(dropIndex(cell, 0, 0, 9)).toBe(1);
		expect(dropIndex(cell, 1, 0, 9)).toBe(4);
		expect(dropIndex(cell, 2, 0, 9)).toBe(5);
		expect(dropIndex(cell, 0, 1, 9)).toBe(0);
		expect(dropIndex([], 0, 0, 9)).toBe(9);
		expect(dropIndex(cell, 0, 2, 7)).toBe(7);
	});
});
