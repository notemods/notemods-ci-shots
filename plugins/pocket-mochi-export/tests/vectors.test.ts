import { describe, expect, it } from 'vitest';
import vectors from './vectors/pocket-mochi-export.json';
import { evaluateCase, type VectorInput } from '../src/vectors';

interface Case {
	name: string;
	args: [VectorInput];
	expected: unknown;
}

describe('golden vectors (packages/spec/vectors/pocket-mochi-export.json)', () => {
	const cases = vectors.cases as unknown as Case[];
	it('has 20 or more cases', () => {
		expect(cases.length).toBeGreaterThanOrEqual(20);
	});
	for (const c of cases) {
		it(c.name, () => {
			const got = evaluateCase(c.args[0]);
			const want = c.expected;
			if (want !== null && typeof want === 'object' && !Array.isArray(want)) {
				const g = got as Record<string, unknown>;
				expect(Object.fromEntries(Object.keys(want).map((k) => [k, g[k]]))).toEqual(want);
			} else {
				expect(got).toEqual(want);
			}
		});
	}
});
