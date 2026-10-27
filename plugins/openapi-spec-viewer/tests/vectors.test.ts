import { describe, expect, it } from 'vitest';
import vectors from './vectors/openapi-spec-viewer.json';
import * as model from '../src/model';

describe('acceptance vectors', () => {
	it('has at least 20 cases', () => expect(vectors.cases.length).toBeGreaterThanOrEqual(20));
	for (const c of vectors.cases) it(c.name, () => {
		const fn = model[c.function as keyof typeof model] as (...args: unknown[]) => unknown;
		let got: unknown;
		try { got = fn(...c.args); } catch (e) { got = { error: (e as Error).message }; }
		if (typeof c.expected === 'object') expect(got).toMatchObject(c.expected);
		else expect(got).toEqual(c.expected);
	});
});
