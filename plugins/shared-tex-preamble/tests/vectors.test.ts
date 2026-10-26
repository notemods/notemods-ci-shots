import { describe, expect, it } from 'vitest';
import vectors from './vectors/shared-tex-preamble.json';
import * as preamble from '../src/preamble';

interface Case {
	name: string;
	acceptance: string;
	function: 'parsePreamble' | 'extractTex' | 'expand' | 'sampleCall' | 'isPreambleExtension' | 'findBlocked' | 'stripComments';
	args: unknown[];
	expected: unknown;
}

describe('golden vectors (packages/spec/vectors/shared-tex-preamble.json)', () => {
	const cases = vectors.cases as Case[];
	it('has 20 or more cases and covers acceptance cases A1 to A8', () => {
		expect(cases.length).toBeGreaterThanOrEqual(20);
		for (let i = 1; i <= 8; i++) expect(cases.some((c) => c.acceptance === `A${i}`)).toBe(true);
	});
	for (const c of cases) {
		it(c.name, () => {
			if (c.function === 'expand') {
				const [src, lib] = c.args as [string, string];
				const r = preamble.expand(src, preamble.parsePreamble(lib).defs);
				expect(r.error ? { error: r.error } : r).toEqual(c.expected);
				return;
			}
			if (c.function === 'sampleCall') {
				expect(preamble.sampleCall(preamble.parsePreamble(c.args[0] as string).defs[0]!)).toEqual(c.expected);
				return;
			}
			const fn = preamble[c.function] as (...a: unknown[]) => unknown;
			expect(fn(...c.args)).toEqual(c.expected);
		});
	}
});
