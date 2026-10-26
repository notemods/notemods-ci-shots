import { describe, expect, it } from 'vitest';
import vectors from './vectors/icon-frontmatter-mirror.json';
import { decide, folderNotePath, formatIcon, parseIconizeData, planWanted, removalAllowed } from '../src/mirror';

const fns: Record<string, (...args: never[]) => unknown> = { decide, folderNotePath, formatIcon, parseIconizeData, planWanted, removalAllowed };

describe('golden vectors (packages/spec/vectors/icon-frontmatter-mirror.json)', () => {
	it('covers acceptance cases 1 to 7, 9 and 10', () => {
		for (const n of ['1', '2', '3', '4', '5', '6', '7', '9', '10']) expect(vectors.cases.some((c) => c.name.startsWith(`${n} `))).toBe(true);
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
