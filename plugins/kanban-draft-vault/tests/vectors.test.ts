import { describe, expect, it } from 'vitest';
import vectors from './vectors/kanban-draft-vault.json';
import * as model from '../src/model';

describe('golden acceptance vectors', () => {
	it('has at least 20 vectors', () => expect(vectors.cases.length).toBeGreaterThanOrEqual(20));
	for (const c of vectors.cases) {
		it(c.name, () => {
			const fn = (model as unknown as Record<string, (...args: unknown[]) => unknown>)[c.function ?? vectors.function]!;
			expect(fn(...c.args)).toEqual(c.expected);
		});
	}
});
