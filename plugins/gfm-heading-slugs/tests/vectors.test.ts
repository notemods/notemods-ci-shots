import { describe, expect, it } from 'vitest';
import vectors from './vectors/gfm-heading-slugs.json';
import { convertText, findObsidian, findSlug, githubLink, headingAtLine, linkAt, mayHoldLink, parseLinks, planConvert, slugAll, slugify } from '../src/slug';

const fns: Record<string, (...args: never[]) => unknown> = { slugify, slugAll, parseLinks, linkAt, findSlug, findObsidian, planConvert, convertText, mayHoldLink, githubLink, headingAtLine };

describe('golden vectors (packages/spec/vectors/gfm-heading-slugs.json)', () => {
	it('covers acceptance cases 1 to 5 and 7 with at least 30 GitHub headings', () => {
		for (const n of ['1', '2', '3', '4', '5', '7']) expect(vectors.cases.some((c) => c.name.startsWith(`${n} `))).toBe(true);
		const github = vectors.cases.filter((c) => c.fn === 'slugAll' && c.name.includes('GitHub API'));
		const count = github.reduce((s, c) => s + (c.args[0] as string[]).length, 0);
		expect(count).toBeGreaterThanOrEqual(30);
	});
	for (const c of vectors.cases) {
		it(c.name, () => {
			const fn = fns[c.fn];
			expect(fn).toBeTypeOf('function');
			expect(fn!(...(c.args as never[]))).toEqual(c.expected);
		});
	}
});
