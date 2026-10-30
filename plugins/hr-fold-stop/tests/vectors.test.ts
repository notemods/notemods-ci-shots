// Golden vectors from packages/spec/vectors/hr-fold-stop.json run against the real code.
import { describe, expect, it } from 'vitest';
import vectors from './vectors/hr-fold-stop.json';
import { effectiveRuleForPath } from '../src/rules';
import { foldStopForText } from '../src/boundaries';

interface Case {
	name: string;
	args: [string, number, number];
	expected: { stop: number | null; kind: 'heading' | 'rule' | null };
}

interface MarkerCase {
	name: string;
	args: [string, number, number, boolean];
	expected: { stop: number | null; kind: 'heading' | 'rule' | 'marker' | null };
}

describe('golden vectors (packages/spec/vectors/hr-fold-stop.json)', () => {
	it('has at least 20 cases', () => {
		expect(vectors.cases.length).toBeGreaterThanOrEqual(20);
	});
	for (const c of vectors.cases as unknown as Case[]) {
		it(c.name, () => {
			expect(foldStopForText(...c.args)).toEqual(c.expected);
		});
	}
});

describe('end marker vectors (markerCases)', () => {
	it('has at least 20 cases', () => {
		expect(vectors.markerCases.length).toBeGreaterThanOrEqual(20);
	});
	for (const c of vectors.markerCases as unknown as MarkerCase[]) {
		it(c.name, () => {
			expect(foldStopForText(...c.args)).toEqual(c.expected);
		});
	}
});

for (const c of vectors.ruleCases) {
 it(c.name, () => expect(effectiveRuleForPath(c.args[0] as never, c.args[1] as string, c.args[2] as never)).toEqual(c.expected));
}
