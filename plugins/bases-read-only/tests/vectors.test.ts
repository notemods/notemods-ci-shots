import { describe, expect, it } from 'vitest';
import vectors from './vectors/bases-read-only.json';
import * as policy from '../src/policy';

describe('golden acceptance vectors', () => {
	it('has at least 20 vectors', () => expect(vectors.cases.length).toBeGreaterThanOrEqual(20));
	for (const c of vectors.cases) {
		it(c.name, () => {
			const name = ('function' in c ? c.function : vectors.function) as keyof typeof policy;
			const fn = policy[name] as (...args: unknown[]) => unknown;
			expect(fn(...c.args)).toEqual(c.expected);
		});
	}
});
