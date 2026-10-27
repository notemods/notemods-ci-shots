import { describe, expect, it } from 'vitest';
import * as core from '../src/core';
import vectors from './vectors/chapter-batch-export.json';
describe('golden acceptance cases', () => {
	for (const entry of vectors.cases) it(entry.name, () => {
		const fn = (core as unknown as Record<string, (...args: unknown[]) => unknown>)[entry.function]!;
		if ('error' in entry) expect(() => fn(...entry.args)).toThrow(entry.error as string);
		else expect(fn(...entry.args)).toEqual(entry.expected);
	});
});
