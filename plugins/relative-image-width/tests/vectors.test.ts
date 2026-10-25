import { describe, expect, it } from 'vitest';
import vectors from './vectors/relative-image-width.json';
import { defaultSize, findPandocAttrs, isImageLink, parsePandocAttrs, parseSize, splitAlt } from '../src/size';

const fns: Record<string, (...args: never[]) => unknown> = { parseSize, splitAlt, parsePandocAttrs, findPandocAttrs, isImageLink, defaultSize };

describe('golden vectors (packages/spec/vectors/relative-image-width.json)', () => {
	it('covers acceptance groups 1 to 7', () => {
		for (const n of ['1', '2', '3', '4', '5', '6', '7']) expect(vectors.cases.some((c) => c.name.startsWith(`${n} `))).toBe(true);
		expect(vectors.cases.length).toBeGreaterThanOrEqual(40);
	});
	for (const c of vectors.cases) {
		it(c.name, () => {
			const fn = fns[c.fn];
			expect(fn).toBeTypeOf('function');
			expect(fn!(...(c.args as never[]))).toEqual(c.expected);
		});
	}
});
