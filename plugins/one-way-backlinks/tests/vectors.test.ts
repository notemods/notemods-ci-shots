import { describe, expect, it } from 'vitest';
import vectors from './vectors/one-way-backlinks.json';
import { appendLinkLine, inFolder, linkBackSuffix, nameAndFolder, parseFolders, splitBacklinks } from '../src/links';

const fns: Record<string, (...args: never[]) => unknown> = { splitBacklinks, appendLinkLine, linkBackSuffix, parseFolders, inFolder, nameAndFolder };

describe('golden vectors (packages/spec/vectors/one-way-backlinks.json)', () => {
	it('covers acceptance cases 1 to 8', () => {
		for (const n of ['1', '2', '3', '4', '5', '6', '7', '8']) expect(vectors.cases.some((c) => c.name.startsWith(`${n} `))).toBe(true);
		expect(vectors.cases.length).toBeGreaterThanOrEqual(20);
	});
	for (const c of vectors.cases) {
		it(c.name, () => {
			const fn = fns[c.fn];
			expect(fn).toBeTypeOf('function');
			expect(fn!(...(c.args as never[]))).toEqual(c.expected);
		});
	}
});
