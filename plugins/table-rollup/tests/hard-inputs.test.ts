import { describe, expect, it } from 'vitest';
import { parseNumber, rollup, summarize, uniqueHeader } from '../src/table';

describe('hard inputs', () => {
	it('keeps columns when a repeated header collides with a written suffix', () => {
		const markdown = '| Item | Amount | Amount | Amount (2) |\n|---|---|---|---|\n| Tea | 1 | 2 | 3 |';
		const result = rollup([{ path: 'Expenses.md', markdown }]);
		expect(result.columns).toEqual(['Item', 'Amount', 'Amount (3)', 'Amount (2)']);
		expect(result.rows[0]?.cells).toEqual(['Tea', '1', '2', '3']);
		expect(uniqueHeader(['', 'Column 1', 'column 1'])).toEqual(['Column 1 (2)', 'Column 1', 'column 1 (3)']);
	});

	it('reads currency signs with a sign before or after the symbol', () => {
		for (const [cell, expected] of [['₫1,000', 1000], ['₩2,000', 2000], ['$-1,200.50', -1200.5], ['-€3.10', -3.1], ['(£2,500)', -2500]] as const) expect(parseNumber(cell)).toBe(expected);
		for (const cell of ['1,23', '$1€', '$--3', '1 2', '1e999']) expect(parseNumber(cell)).toBeNull();
	});

	it('keeps small exponent values in summaries', () => {
		expect(summarize(['1e-3', '2e-3'], 'sum')).toBe('0.003');
		expect(summarize(['1.25e-2', '2.5e-2'], 'avg')).toBe('0.01875');
		expect(summarize(['1e-3', '2e-3'], 'min')).toBe('0.001');
	});

	it('keeps 2000 rows and empty cells with currency totals', () => {
		const markdown = '| Item | Amount | Empty |\n|---|---|---|\n' + Array.from({ length: 2000 }, (_, i) => `| Row ${i} | ₫1,000 | |`).join('\n');
		const result = rollup([{ path: 'Expenses.md', markdown }], { summary: 'sum' });
		expect(result.rows).toHaveLength(2000);
		expect(result.rows.at(-1)?.cells).toEqual(['Row 1999', '₫1,000', '']);
		expect(result.summary).toEqual([null, '2000000', null]);
	});
});
