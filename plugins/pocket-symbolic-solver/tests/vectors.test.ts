import { describe, expect, it } from 'vitest';
import vectors from './vectors/pocket-symbolic-solver.json';
import * as solve from '../src/solve';
import { searchHistory } from '../src/settings';

interface Case {
	name: string;
	function?: 'solveToInsert' | 'noteAfter' | 'substituteTable' | 'parseTable' | 'searchHistory';
	args: unknown[];
	expected: unknown;
}

const FNS: Record<NonNullable<Case['function']>, (...a: never[]) => unknown> = {
	solveToInsert: solve.solveToInsert,
	noteAfter: solve.noteAfter,
	substituteTable: solve.substituteTable,
	parseTable: solve.parseTable,
	searchHistory,
};

describe('golden vectors (packages/spec/vectors/pocket-symbolic-solver.json)', () => {
	const cases = vectors.cases as Case[];
	it('has 20 or more cases and one for each of the 10 acceptance cases', () => {
		expect(cases.length).toBeGreaterThanOrEqual(20);
		for (let n = 1; n <= 10; n++) expect(cases.some((c) => c.name.includes(`(acceptance ${n})`))).toBe(true);
	});
	for (const c of cases) {
		it(c.name, () => {
			const fn = c.function ? (FNS[c.function] as (...a: unknown[]) => unknown) : (solve.solveEquation as (...a: unknown[]) => unknown);
			expect(fn(...c.args)).toEqual(c.expected);
		});
	}
});
