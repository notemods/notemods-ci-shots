import { describe, expect, it } from 'vitest';
import { buildView, matchesFilter, parseConfig, parseLinks } from '../src/embed';

const A = '---\nkanban-plugin: board\n---\n\n## Todo\n\n- [ ] a1 #web\n- [x] a2\n\n## Doing (1)\n\n- [ ] a3 #web\n- [ ] a4\n';
const B = '---\nkanban-plugin: board\n---\n\n## doing\n\n- [ ] b1\n\n## Review\n\n- [ ] b2 #web\n';

describe('parseConfig', () => {
	it('reads boards, lanes, hide-done, filter and title', () => {
		const c = parseConfig('board: [[Projects/Site|Site]], [[Other]]\nlanes: Doing, Review\nhide-done: yes\nfilter: #web fix\ntitle: This week\n');
		expect(c).toEqual({ boards: ['Projects/Site', 'Other'], lanes: ['Doing', 'Review'], hideDone: true, filter: ['#web', 'fix'], title: 'This week', errors: [] });
	});

	it('reports unknown lines, bad values and a missing board', () => {
		const c = parseConfig('colour: red\nhide-done: maybe');
		expect(c.errors).toEqual(['Unknown line: colour: red', 'hide-done must be true or false: maybe', 'Add a line like: board: [[My board]]']);
	});

	it('accepts plain paths and several board lines', () => {
		expect(parseLinks('Boards/A.md, "Boards/B"')).toEqual(['Boards/A.md', 'Boards/B']);
		expect(parseConfig('board: A\nboards: B').boards).toEqual(['A', 'B']);
	});

	it('drops a heading part of a link', () => {
		expect(parseLinks('[[Board#Doing]]')).toEqual(['Board']);
	});
});

describe('buildView', () => {
	const boards = [
		{ path: 'A.md', name: 'A', markdown: A },
		{ path: 'B.md', name: 'B', markdown: B },
	];

	it('shows every lane of one board in order with totals', () => {
		const v = buildView([boards[0]!]);
		expect(v.columns.map((c) => [c.title, c.total, c.maxItems])).toEqual([
			['Todo', 2, 0],
			['Doing', 2, 1],
		]);
		expect(v.cards).toBe(4);
	});

	it('merges lanes with the same title across boards and keeps where each card lives', () => {
		const v = buildView(boards);
		const doing = v.columns.find((c) => c.title === 'Doing')!;
		expect(doing.cards.map((c) => [c.text, c.board, c.lane, c.index])).toEqual([
			['a3 #web', 0, 1, 0],
			['a4', 0, 1, 1],
			['b1', 1, 0, 0],
		]);
		expect(doing.targets).toEqual([
			{ board: 0, lane: 1, size: 2 },
			{ board: 1, lane: 0, size: 1 },
		]);
		expect(v.columns.map((c) => c.title)).toEqual(['Todo', 'Doing', 'Review']);
	});

	it('picks lanes in the asked order and reports missing ones', () => {
		const v = buildView(boards, { lanes: ['review', 'Todo', 'Later'] });
		expect(v.columns.map((c) => c.title)).toEqual(['Review', 'Todo']);
		expect(v.missingLanes).toEqual(['Later']);
	});

	it('hides done cards and filters by tag and word', () => {
		const v = buildView(boards, { hideDone: true, filter: ['#web'] });
		expect(v.columns.map((c) => c.cards.map((x) => x.text))).toEqual([['a1 #web'], ['a3 #web'], ['b2 #web']]);
		expect(v.hidden).toBe(3);
	});

	it('keeps the first line of each card for the stale check', () => {
		expect(buildView([boards[0]!]).columns[0]!.cards[1]!.raw).toBe('- [x] a2');
	});

	it('lists notes without the board key', () => {
		expect(buildView([{ path: 'n.md', name: 'n', markdown: '## A\n- [ ] x' }]).notBoards).toEqual(['n.md']);
	});

	it('matchesFilter matches nested tags and is case blind', () => {
		expect(matchesFilter({ text: 'Fix Login', tags: ['#web/auth'] }, ['#WEB', 'login'])).toBe(true);
		expect(matchesFilter({ text: 'Fix', tags: ['#webdev'] }, ['#web'])).toBe(false);
	});
});
