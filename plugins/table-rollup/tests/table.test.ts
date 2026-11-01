import { describe, expect, it } from 'vitest';
import { compareCells, delimiterRow, findTables, findTasks, formatNumber, normName, parseNumber, rollup, splitRow, summarize, toCsv, toMarkdown, uniqueHeader } from '../src/table';

describe('splitRow', () => {
	it('splits with and without outer pipes', () => {
		expect(splitRow('| a | b |')).toEqual(['a', 'b']);
		expect(splitRow('a | b')).toEqual(['a', 'b']);
		expect(splitRow('| a | b')).toEqual(['a', 'b']);
		expect(splitRow('a | b |')).toEqual(['a', 'b']);
	});
	it('keeps empty cells', () => {
		expect(splitRow('|  | b |  |')).toEqual(['', 'b', '']);
	});
	it('returns null for a line with no pipe', () => {
		expect(splitRow('just text')).toBeNull();
		expect(splitRow('escaped \\| only')).toBeNull();
	});
	it('does not split on pipes in code spans, double backticks or wikilinks', () => {
		expect(splitRow('| `a|b` | ``c|`d`` | [[x|y]] |')).toEqual(['`a|b`', '``c|`d``', '[[x|y]]']);
	});
	it('treats an unclosed backtick as text', () => {
		expect(splitRow('| `a | b |')).toEqual(['`a', 'b']);
	});
	it('a trailing escaped pipe is text, not the row end', () => {
		expect(splitRow('| a | b \\|')).toEqual(['a', 'b |']);
	});
});

describe('delimiterRow', () => {
	it('reads alignment', () => {
		expect(delimiterRow(splitRow('| --- | :-- | --: | :-: |'))).toEqual([null, 'left', 'right', 'center']);
	});
	it('rejects non-delimiter rows', () => {
		expect(delimiterRow(splitRow('| --- | abc |'))).toBeNull();
		expect(delimiterRow(splitRow('| : | --- |'))).toBeNull();
		expect(delimiterRow(null)).toBeNull();
	});
});

describe('findTables', () => {
	it('needs a delimiter row with the same cell count as the header', () => {
		expect(findTables('| a | b |\n| --- |\n| 1 | 2 |\n')).toEqual([]);
	});
	it('ends a table at a blank line or a line without a pipe', () => {
		const t = findTables('| a |\n|---|\n| 1 |\ntext\n| 2 |\n');
		expect(t).toHaveLength(1);
		expect(t[0]!.rows).toEqual([['1']]);
	});
	it('records the heading stack and the line', () => {
		const t = findTables('# A\n## B\n\n| x |\n|---|\n| 1 |\n## C\n| y |\n|---|\n| 2 |\n');
		expect(t.map((x) => [x.headings, x.line])).toEqual([
			[['A', 'B'], 3],
			[['A', 'C'], 7],
		]);
	});
	it('ignores ~~~ fences and longer fences', () => {
		expect(findTables('~~~~\n| a |\n|---|\n| 1 |\n~~~\n| b |\n~~~~\n')).toEqual([]);
	});
	it('handles CRLF line ends', () => {
		expect(findTables('| a |\r\n|---|\r\n| 1 |\r\n')[0]!.rows).toEqual([['1']]);
	});
	it('a header without body rows is a table with no rows', () => {
		expect(findTables('| a |\n|---|\n')[0]!.rows).toEqual([]);
	});
});

describe('findTasks', () => {
	it('reads ordered and starred task items, any heading when empty', () => {
		const t = findTasks('* [ ] one\n1. [x] two\n- not a task\n', '');
		expect(t.rows).toEqual([
			['one', 'no', ''],
			['two', 'yes', ''],
		]);
	});
	it('skips tasks in code blocks', () => {
		expect(findTasks('```\n- [ ] no\n```\n', '').rows).toEqual([]);
	});
});

describe('names and numbers', () => {
	it('normName strips marks and case', () => {
		expect(normName('## **Action** [[x|Items]]')).toBe('action items');
		expect(normName('  Amount   (EUR) ')).toBe('amount (eur)');
	});
	it('uniqueHeader names empty and repeated headers', () => {
		expect(uniqueHeader(['', 'a', 'A', 'a'])).toEqual(['Column 1', 'a', 'A (2)', 'a (3)']);
	});
	it('parseNumber reads common forms', () => {
		expect(parseNumber('1,234.5')).toBe(1234.5);
		expect(parseNumber('$12')).toBe(12);
		expect(parseNumber('-€3.10')).toBe(-3.1);
		expect(parseNumber('12 %')).toBe(12);
		expect(parseNumber('(4.50)')).toBe(-4.5);
		expect(parseNumber('**7**')).toBe(7);
		expect(parseNumber('−5')).toBe(-5);
		expect(parseNumber('.5')).toBe(0.5);
	});
	it('parseNumber refuses text, dates and bad separators', () => {
		for (const s of ['', 'abc', '2026-10-10', '1,23', '12abc', '1.2.3', '$', 'NaN', 'Infinity']) expect(parseNumber(s)).toBeNull();
	});
	it('formatNumber removes float noise and trailing zeros', () => {
		expect(formatNumber(0.1 + 0.2, 1)).toBe('0.3');
		expect(formatNumber(2, 2)).toBe('2');
		expect(formatNumber(-0.0001, 2)).toBe('0');
	});
	it('summarize needs a pure number column for math', () => {
		expect(summarize(['1', 'x'], 'sum')).toBeNull();
		expect(summarize(['', ''], 'sum')).toBeNull();
		expect(summarize(['3', '1.25', ''], 'min')).toBe('1.25');
		expect(summarize(['3', '1.25'], 'max')).toBe('3');
		expect(summarize(['a', ''], 'count')).toBe('1');
		expect(summarize(['1'], 'none')).toBeNull();
	});
	it('compareCells sorts numbers as numbers and text naturally', () => {
		expect(['10', '9', '100'].sort(compareCells)).toEqual(['9', '10', '100']);
		expect(['item 10', 'Item 2', 'item 1'].sort(compareCells)).toEqual(['item 1', 'Item 2', 'item 10']);
	});
});

describe('export', () => {
	const r = rollup(
		[
			{ path: 'Notes/a.md', markdown: '| Item | Amount |\n|---|--:|\n| Tea, hot | 2 |\n| a \\| b | 3 |\n' },
			{ path: 'b.md', markdown: '| Item | Amount |\n|---|---|\n| "Big" cake | 5 |\n' },
		],
		{ summary: 'sum' },
	);
	it('Markdown escapes pipes, links the source and adds the summary row', () => {
		expect(toMarkdown(r)).toBe(
			[
				'| Source | Item | Amount |',
				'| --- | --- | --: |',
				'| [[Notes/a\\|a]] | Tea, hot | 2 |',
				'| [[Notes/a\\|a]] | a \\| b | 3 |',
				'| [[b\\|b]] | "Big" cake | 5 |',
				'| **Summary** |  | 10 |',
				'',
			].join('\n'),
		);
	});
	it('the Markdown export parses back to the same rows', () => {
		const back = rollup([{ path: 'x.md', markdown: toMarkdown(r, false) }]);
		expect(back.rows.map((x) => x.cells).slice(0, 3)).toEqual(r.rows.map((x) => x.cells));
	});
	it('CSV quotes commas and quotes and keeps the path', () => {
		expect(toCsv(r)).toBe('Source,Item,Amount\r\nNotes/a.md,"Tea, hot",2\r\nNotes/a.md,a | b,3\r\nb.md,"""Big"" cake",5\r\n');
	});
	it('without the source column', () => {
		expect(toCsv(r, false).split('\r\n')[0]).toBe('Item,Amount');
	});
});

describe('find', () => {
	const notes = [
		{ path: 'Notes/meet-1.md', markdown: '| Item | Owner | Hours |\n|---|---|--:|\n| Write spec | Ann | 3 |\n| Review budget | Ben | 2 |\n' },
		{ path: 'Notes/meet-2.md', markdown: '| Item | Owner | Hours |\n|---|---|--:|\n| Plan launch | Carl | 5 |\n' },
	];

	it('keeps only the rows where a cell holds the text, case insensitive', () => {
		const r = rollup(notes, { find: 'budget' });
		expect(r.rows.map((x) => x.cells[0])).toEqual(['Review budget']);
		expect(rollup(notes, { find: 'BUDGET' }).rows.map((x) => x.cells[0])).toEqual(['Review budget']);
	});

	it('matches the source note name and keeps the summary over the left rows', () => {
		const r = rollup(notes, { find: 'meet-2', summary: 'sum' });
		expect(r.rows.length).toBe(1);
		expect(r.sources).toBe(2);
		expect(r.summary?.[2]).toBe('5');
	});

	it('empty or blank find text keeps every row', () => {
		expect(rollup(notes, { find: '' }).rows.length).toBe(3);
		expect(rollup(notes, { find: '   ' }).rows.length).toBe(3);
	});

	it('a text with no match keeps no row and the group counts shrink', () => {
		const r = rollup(notes, { find: 'zzz', groupBy: 'Owner' });
		expect(r.rows.length).toBe(0);
		expect(r.groups).toEqual([]);
	});

	it('find runs before the Pro column filter and the sort stay consistent', () => {
		const r = rollup(notes, { find: 'plan', filter: { column: 'Hours', op: 'gt', value: '4' } });
		expect(r.rows.map((x) => x.cells[0])).toEqual(['Plan launch']);
	});
});

describe('summarize on a large column', () => {
	it('gives the sum, min and max of 200,000 cells without a stack overflow', () => {
		const cells = Array.from({ length: 200_000 }, (_, i) => String(i % 10) + '.5');
		expect(summarize(cells, 'sum')).toBe('1000000');
		expect(summarize(cells, 'min')).toBe('0.5');
		expect(summarize(cells, 'max')).toBe('9.5');
	});
});
