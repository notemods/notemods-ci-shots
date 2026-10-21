import { describe, expect, it } from 'vitest';
import vectors from './vectors/bases-date-backlinks.json';
import * as matcher from '../src/matcher';
import * as basefile from '../src/basefile';

interface Case {
	name: string;
	function?: keyof typeof matcher | keyof typeof basefile;
	args: unknown[];
	expected: unknown;
}

describe('golden vectors (packages/spec/vectors/bases-date-backlinks.json)', () => {
	const cases = vectors.cases as Case[];
	it('has a vector for each acceptance case and at least 20 cases', () => {
		expect(cases.length).toBeGreaterThanOrEqual(20);
	});
	for (const testCase of cases) {
		it(testCase.name, () => {
			const fn = testCase.function ?? 'matchRows';
			const operation = fn in matcher ? matcher[fn as keyof typeof matcher] : basefile[fn as keyof typeof basefile];
			expect((operation as (...args: unknown[]) => unknown)(...testCase.args)).toEqual(testCase.expected);
		});
	}
});
