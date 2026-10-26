import { describe, expect, it } from 'vitest';
import vectors from './vectors/note-ris-export.json';
import * as ris from '../src/ris';

describe('golden acceptance vectors', () => {
	it('has 20 or more cases', () => {
		expect(vectors.cases.length).toBeGreaterThanOrEqual(20);
	});
	for (const c of vectors.cases) it(c.name, () => {
		const fn = ris[c.function as keyof typeof ris] as (...args: unknown[]) => unknown;
		expect(fn(...c.args)).toEqual(c.expected);
	});
});
