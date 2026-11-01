import { describe, expect, it } from 'vitest';
import { parseAlias, planLine } from '../src/markup';

describe('A10 large inputs', () => {
	it('plans 5,000 lines with links in well under a second', () => {
		const lines = Array.from({ length: 5000 }, (_, i) => `Line ${i} with [[Note ${i}|\`code ${i}\`]] and [[B|**bold** *it*]] and text.`);
		const t0 = performance.now();
		let n = 0;
		for (const l of lines) n += planLine(l).length;
		const ms = performance.now() - t0;
		expect(n).toBe(10000);
		expect(ms).toBeLessThan(1000);
	});

	it('parses a hostile alias of many delimiters in bounded time', () => {
		const alias = '*a '.repeat(300) + '_'.repeat(300);
		const t0 = performance.now();
		parseAlias(alias);
		expect(performance.now() - t0).toBeLessThan(2000);
	});

	it('keeps an alias over the size limit as text', () => {
		const alias = '**x** '.repeat(400);
		expect(parseAlias(alias)).toEqual([{ type: 'text', from: 0, to: alias.length, text: alias }]);
	});
});
