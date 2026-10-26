import { describe, expect, it } from 'vitest';
import vectors from './vectors/note-word-comments.json';
import { summarizeNote, type ParseOptions } from '../src/parse';

interface Case {
	name: string;
	args: [string, ParseOptions];
	expected: unknown;
}

describe('golden vectors (packages/spec/vectors/note-word-comments.json)', () => {
	const cases = vectors.cases as Case[];
	it('has 20 or more cases, with one for each acceptance case', () => {
		expect(cases.length).toBeGreaterThanOrEqual(20);
		for (const n of ['Case 1', 'Case 2', 'Case 3', 'Case 4', 'Case 5', 'Case 6', 'Case 7', 'Case 8a']) expect(cases.some((c) => c.name.startsWith(n))).toBe(true);
	});
	for (const c of cases) {
		it(c.name, () => {
			expect(summarizeNote(...c.args)).toEqual(c.expected);
		});
	}
});
