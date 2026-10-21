import { describe, expect, it } from 'vitest';
import vectors from './vectors/fountain-reference-panel.json';
import * as scan from '../src/scan';

interface Case {
	name: string;
	function?: 'parseFolders' | 'inFolders' | 'sceneHeading' | 'cleanLine';
	args: unknown[];
	expected: unknown;
}

describe('golden vectors (packages/spec/vectors/fountain-reference-panel.json)', () => {
	const cases = vectors.cases as Case[];
	it('has at least 20 findIncoming cases', () => {
		expect(cases.filter((c) => !c.function).length).toBeGreaterThanOrEqual(20);
	});
	for (const c of cases) {
		it(c.name, () => {
			const fn = (c.function ? scan[c.function] : scan.findIncoming) as (...a: unknown[]) => unknown;
			expect(fn(...c.args)).toEqual(c.expected);
		});
	}
});
