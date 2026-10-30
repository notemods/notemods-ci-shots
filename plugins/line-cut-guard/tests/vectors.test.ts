import { describe, expect, it } from 'vitest';
import vectors from './vectors/line-cut-guard.json';
import { effectiveMode, lineRanges, mayNotify, noticeText, nothingSelected, shortcutKind, step } from '../src/guard';

const fns: Record<string, (...args: never[]) => unknown> = { step, effectiveMode, nothingSelected, mayNotify, noticeText, shortcutKind, lineRanges };

describe('golden vectors (packages/spec/vectors/line-cut-guard.json)', () => {
	it('covers acceptance criteria A1 to A8 that have pure rules', () => {
		for (const n of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8']) expect(vectors.cases.some((c) => c.name.startsWith(`${n} `))).toBe(true);
		expect(vectors.cases.length).toBeGreaterThanOrEqual(50);
	});
	for (const c of vectors.cases) {
		it(c.name, () => {
			const fn = fns[c.fn];
			expect(fn).toBeTypeOf('function');
			expect(fn!(...(c.args as never[]))).toEqual(c.expected);
		});
	}
});
