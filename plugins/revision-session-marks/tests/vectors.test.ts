import { describe, expect, it } from 'vitest';
import vectors from './vectors/revision-session-marks.json';
import { makeReview, restoreReview } from '../src/review';
import { assertMatch, loadState } from '../src/state';

const functions: Record<string, (...args: never[]) => unknown> = { makeReview, assertMatch, loadState };
describe('Golden acceptance vectors', () => {
  it('has more than 20 cases', () => expect(vectors.cases.length).toBeGreaterThanOrEqual(20));
  for (const c of vectors.cases) {
    it(c.name, () => {
      let result: unknown;
      try { result = functions[('function' in c ? c.function : 'makeReview') as string]!(...c.args as never[]); }
      catch (error) { result = { error: (error as Error).message }; }
      expect(result).toEqual(c.expected);
      if (!('function' in c) && 'text' in c.expected) {
        expect(restoreReview(c.expected.text, true)).toBe(c.args[1]);
        expect(restoreReview(c.expected.text, false)).toBe(c.args[0]);
      }
    });
  }
});
