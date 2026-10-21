import { describe, expect, it } from 'vitest';
import vectors from './vectors/epoch-note-converter.json';
import { convert, column, editText } from '../src/converter';
import { sameSnapshot } from '../src/edit';

const functions = { convert, column, editText, sameSnapshot };
interface Case { name: string; function?: keyof typeof functions; args: unknown[]; expected: unknown }
describe('golden acceptance vectors', () => {
	it('has at least twenty vectors', () => expect(vectors.cases.length).toBeGreaterThanOrEqual(20));
	for (const c of vectors.cases as Case[]) it(c.name, () => {
		const fn = functions[c.function ?? 'convert'] as (...args: unknown[]) => unknown;
		expect(fn(...c.args)).toEqual(c.expected);
	});
});
