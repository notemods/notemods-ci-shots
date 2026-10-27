import { describe, expect, it } from 'vitest';
import { spellFocusRange } from '../src/core/index';
import vectors from './vectors/paragraph-spell-focus.json';

describe('spelling focus boundaries', () => {
 for (const c of vectors.cases) it(c.name, () => {
  const [text, pos, scope] = c.args;
  expect(spellFocusRange(text as string, pos as number, scope as 'paragraph' | 'section')).toEqual(c.expected);
 });
 it('limits section scans in a large note', () => {
  const text = '# Header\n\n' + 'text\n'.repeat(400001);
  const range = spellFocusRange(text, 2, 'section');
  expect(range).toEqual({ from: 0, to: 8 });
 });
});
