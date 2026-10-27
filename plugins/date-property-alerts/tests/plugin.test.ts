import { describe, expect, it } from 'vitest';
import { claim, normalizeLedger, rowsFor } from '../src/alerts';

describe('delivery state persistence', () => {
 it('keeps dismissed state across JSON storage', () => {
  const row = rowsFor([{path:'Review.md',value:'2020-01-01T09:00Z'}], 'note.due').rows[0]!;
  const state = normalizeLedger(null); claim([row], state, Date.now());
  expect(claim([row], normalizeLedger(JSON.parse(JSON.stringify(state))), Date.now())).toEqual([]);
 });
 it('stores no note text in a delivery record', () => {
  const row = rowsFor([{path:'Review.md',value:'2020-01-01T09:00Z'}], 'note.due').rows[0]!;
  const state = normalizeLedger(null); claim([row], state, Date.now());
  expect(state[row.key]).toEqual({delivered:true,snoozeUntil:0,updatedAt:expect.any(Number)});
 });
});
