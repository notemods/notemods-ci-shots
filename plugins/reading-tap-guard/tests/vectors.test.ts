import { describe, expect, it } from 'vitest';
import vectors from './vectors/reading-tap-guard.json';
import { doubleTaps, effective, ruleWordBounds, wordBounds } from '../src/taps';
import { normalizeSettings } from '../src/settings';

const fns: Record<string, (...args: never[]) => unknown> = { doubleTaps, effective, wordBounds, ruleWordBounds, normalizeSettings };

describe('golden vectors (packages/spec/vectors/reading-tap-guard.json)', () => {
	it('covers spec rules 1 to 10', () => {
		for (const n of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']) expect(vectors.cases.some((c) => c.name.startsWith(`${n} `))).toBe(true);
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
