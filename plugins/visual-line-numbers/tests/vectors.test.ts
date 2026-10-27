import { describe, expect, it } from 'vitest';
import vectors from './vectors/visual-line-numbers.json';
import { labelUnits, type LabelOptions, type Unit } from '../src/numbering';

describe('golden vectors (packages/spec/vectors/visual-line-numbers.json)', () => {
	it('has at least 20 cases', () => {
		expect(vectors.cases.length).toBeGreaterThanOrEqual(20);
	});
	for (const c of vectors.cases) {
		it(c.name, () => {
			const [units, opts] = c.args as [Unit[], LabelOptions];
			const got = labelUnits(units, opts).map((rows) => rows.map((r) => r.text));
			expect(got).toEqual(c.expected);
		});
	}
});
