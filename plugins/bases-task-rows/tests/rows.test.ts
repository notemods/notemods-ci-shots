import { describe, expect, it } from 'vitest';
import { FREE_LIMIT, addDays, arrangeRows, bucketOf, collectTasks, sortRows, type ArrangeOptions, type TaskRow } from '../src/rows';
import { parseTaskLine } from '../src/task';

const NOTE = ['# Plan', '- [ ] Pay rent 📅 2026-10-12 #home', '## Work', '- [x] Ship v2 ✅ 2026-10-01 #work', '```', '- [ ] code', '```', '- [ ] Call Ana [due:: 2026-10-09] #work #people', '- not a task'].join('\n');
const ITEMS = [{ line: 1, task: ' ' }, { line: 3, task: 'x' }, { line: 7, task: ' ' }, { line: 8 }];
const HEADINGS = [{ line: 0, heading: 'Plan' }, { line: 2, heading: 'Work' }];
const opts = (o: Partial<ArrangeOptions> = {}): ArrangeOptions => ({ status: 'all', query: '', sort: 'file', descending: false, group: 'none', limit: Infinity, today: '2026-10-10', ...o });

function row(path: string, line: number, raw: string): TaskRow {
	return { id: `${path}#${line}`, path, note: path.replace(/\.md$/, ''), line, raw, heading: '', info: parseTaskLine(raw)! };
}

describe('collectTasks', () => {
	const rows = collectTasks('Plan.md', 'Plan', NOTE, ITEMS, HEADINGS);

	it('takes only the lines the cache marks as tasks, with the nearest heading', () => {
		expect(rows.map((r) => [r.line, r.heading, r.info.text])).toEqual([
			[1, 'Plan', 'Pay rent'],
			[3, 'Work', 'Ship v2'],
			[7, 'Work', 'Call Ana'],
		]);
	});

	it('skips a cache line that no longer reads as a task (file changed after the cache)', () => {
		expect(collectTasks('Plan.md', 'Plan', NOTE, [{ line: 8, task: ' ' }, { line: 40, task: ' ' }], [])).toEqual([]);
	});

	it('keeps the carriage return in raw for CRLF files', () => {
		const r = collectTasks('c.md', 'c', '- [ ] a\r\n- [ ] b\r\n', [{ line: 0, task: ' ' }, { line: 1, task: ' ' }], []);
		expect(r.map((x) => x.raw)).toEqual(['- [ ] a\r', '- [ ] b\r']);
	});
});

describe('date buckets', () => {
	const b = (raw: string) => bucketOf(parseTaskLine(raw)!, '2026-10-10');
	it('sorts tasks into overdue, today, next 7 days, later, no date and done', () => {
		expect(b('- [ ] a 📅 2026-10-09')).toBe('overdue');
		expect(b('- [ ] a 📅 2026-10-10')).toBe('today');
		expect(b('- [ ] a 📅 2026-10-17')).toBe('week');
		expect(b('- [ ] a 📅 2026-10-18')).toBe('later');
		expect(b('- [ ] a ⏳ 2026-10-10')).toBe('today');
		expect(b('- [ ] a')).toBe('none');
		expect(b('- [x] a 📅 2026-01-01')).toBe('done');
	});
	it('adds days across months and years in UTC', () => {
		expect(addDays('2026-12-28', 7)).toBe('2027-01-04');
		expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
	});
});

describe('arrangeRows', () => {
	const rows = [
		row('b.md', 0, '- [ ] Late one 📅 2026-10-01 #work'),
		row('a.md', 3, '- [ ] Today one 📅 2026-10-10 🔺 #home'),
		row('a.md', 1, '- [x] Done one 📅 2026-10-02'),
		row('c.md', 5, '- [ ] No date #work #home'),
		row('c.md', 2, '- [ ] Soon ⏳ 2026-10-12 🔽'),
	];

	it('filters by status and by words in the text, tags and note', () => {
		expect(arrangeRows(rows, opts({ status: 'open' })).matched).toBe(4);
		expect(arrangeRows(rows, opts({ status: 'done' })).matched).toBe(1);
		expect(arrangeRows(rows, opts({ query: '#work' })).matched).toBe(2);
		expect(arrangeRows(rows, opts({ query: 'ONE #home' })).matched).toBe(1);
	});

	it('sorts by due date with undated tasks last in both directions', () => {
		const ids = (d: boolean) => sortRows(rows, 'due', d).map((r) => r.info.text);
		expect(ids(false)).toEqual(['Late one', 'Done one', 'Today one', 'Soon', 'No date']);
		expect(ids(true)).toEqual(['Today one', 'Done one', 'Late one', 'Soon', 'No date']);
	});

	it('sorts by priority high first and by file order', () => {
		expect(sortRows(rows, 'priority', false).map((r) => r.info.text)).toEqual(['Today one', 'Done one', 'Late one', 'No date', 'Soon']);
		expect(sortRows(rows, 'file', false).map((r) => r.id)).toEqual(['a.md#1', 'a.md#3', 'b.md#0', 'c.md#2', 'c.md#5']);
	});

	it('groups by date bucket in a fixed order', () => {
		const g = arrangeRows(rows, opts({ group: 'date' })).groups;
		expect(g.map((x) => [x.label, x.rows.length])).toEqual([
			['Overdue', 1],
			['Today', 1],
			['Next 7 days', 1],
			['No date', 1],
			['Done', 1],
		]);
	});

	it('groups by tag, a task with two tags in both groups, untagged last', () => {
		const out = arrangeRows(rows, opts({ group: 'tag' }));
		expect(out.groups.map((x) => [x.label, x.rows.length])).toEqual([
			['#home', 2],
			['#work', 2],
			['No tag', 2],
		]);
		expect(out.shown).toBe(5);
	});

	it('groups by note and by heading', () => {
		expect(arrangeRows(rows, opts({ group: 'note' })).groups.map((x) => x.label)).toEqual(['a', 'b', 'c']);
		expect(arrangeRows(rows, opts({ group: 'heading' })).groups[0]!.label).toBe('a (no heading)');
	});

	it('caps the rows at the limit after sorting', () => {
		const many = Array.from({ length: FREE_LIMIT + 50 }, (_, i) => row(`n${String(i).padStart(4, '0')}.md`, 0, `- [ ] t${i}`));
		const out = arrangeRows(many, opts({ limit: FREE_LIMIT }));
		expect(out).toMatchObject({ matched: 250, shown: 200 });
		expect(out.groups[0]!.rows.at(-1)!.path).toBe('n0199.md');
	});
});
