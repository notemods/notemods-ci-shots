import { describe, expect, it } from 'vitest';
import { insertBlockBelow } from '../src/modal';
import { MAX_INPUT, parseTable, solveEquation, substituteTable } from '../src/solve';

type Pos = { line: number; ch: number };

/** A fake editor over a string, with a selection [from, to). */
function fakeEditor(text: string, from: Pos, to: Pos) {
	let value = text;
	const offset = (p: Pos) => value.split('\n').slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.ch;
	return {
		get value() {
			return value;
		},
		getCursor: (which?: string) => (which === 'from' ? from : to),
		getLine: (n: number) => value.split('\n')[n] ?? '',
		lineCount: () => value.split('\n').length,
		replaceRange: (s: string, p: Pos) => {
			const o = offset(p);
			value = value.slice(0, o) + s + value.slice(o);
		},
	};
}

const TABLE = '| F | m | a |\n| --- | --- | --- |\n| 10 | 2 | 5 |';

describe('insertBlockBelow (Pro table insert)', () => {
	it('puts the table under the line and keeps the text after the selection out of the table', () => {
		const ed = fakeEditor('Force: F=m*a here\nSecond line.\n', { line: 0, ch: 7 }, { line: 0, ch: 12 });
		insertBlockBelow(ed, TABLE);
		// A line directly under a table is a table row in Markdown. A blank line must end the table.
		expect(ed.value).toBe(`Force: F=m*a here\n\n${TABLE}\n\nSecond line.\n`);
	});

	it('does not break the line at the cursor when nothing is selected', () => {
		const ed = fakeEditor('abc def\n', { line: 0, ch: 3 }, { line: 0, ch: 3 });
		insertBlockBelow(ed, TABLE);
		expect(ed.value).toBe(`abc def\n\n${TABLE}\n`);
	});

	it('uses the last selected line when the selection ends at the start of the next line', () => {
		const ed = fakeEditor('F=m*a\nNext.', { line: 0, ch: 0 }, { line: 1, ch: 0 });
		insertBlockBelow(ed, TABLE);
		expect(ed.value).toBe(`F=m*a\n\n${TABLE}\n\nNext.`);
	});
});

describe('substituteTable', () => {
	it('refuses a column for the symbol to solve for', () => {
		const t = parseTable('a, m\n10, 2');
		expect(substituteTable('F=m*a', 'a', ['F*m^-1'], t.header, t.rows)).toEqual({ ok: false, error: 'a is the symbol to solve for. Remove its column' });
	});
});

describe('solveEquation input limit', () => {
	it('refuses an equation longer than 500 characters', () => {
		const long = `x=${'1+'.repeat(250)}1`;
		expect(MAX_INPUT).toBe(500);
		expect(long.length).toBeGreaterThan(500);
		expect(solveEquation(long, 'x')).toEqual({ ok: false, error: 'The equation is longer than 500 characters' });
	});
});
