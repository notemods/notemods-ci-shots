import { describe, expect, it } from 'vitest';
import vectors from './vectors/wikilink-alias-markup.json';
import { findAliasLinks, isDefaultText, parseAlias, planLine } from '../src/markup';

const fns: Record<string, (...args: never[]) => unknown> = { parseAlias, planLine, findAliasLinks, isDefaultText };

describe('golden vectors (packages/spec/vectors/wikilink-alias-markup.json)', () => {
	it('covers acceptance criteria A1, A3, A8, A9 and A12', () => {
		for (const n of ['A1', 'A3', 'A8', 'A9', 'A12']) expect(vectors.cases.some((c) => c.name.startsWith(`${n} `))).toBe(true);
		expect(vectors.cases.length).toBeGreaterThanOrEqual(30);
	});
	for (const c of vectors.cases) {
		it(c.name, () => {
			const fn = fns[c.fn];
			expect(fn).toBeTypeOf('function');
			expect(fn!(...(c.args as never[]))).toEqual(c.expected);
		});
	}
});
