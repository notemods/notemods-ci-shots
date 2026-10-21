import { describe, expect, it } from 'vitest';
import vectors from './vectors/pocket-note-quiz.json';
import * as quiz from '../src/quiz';

describe('golden acceptance vectors', () => {
	for (const c of vectors.cases) it(c.name, () => {
		const fn = quiz[c.function as keyof typeof quiz] as (...args: unknown[]) => unknown;
		expect(fn(...c.args)).toEqual(c.expected);
	});
});
