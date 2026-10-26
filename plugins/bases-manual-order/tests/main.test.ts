import { describe, expect, it } from 'vitest';
import { planMove, rankProperty, rankNumber, sortRows } from '../src/order';
import vectors from './vectors/bases-manual-order.json';
import { App } from 'obsidian-test-mocks/obsidian';
import * as order from '../src/order';

describe('rank ordering', () => {
 for (const v of vectors.cases.filter(v => v.function)) it('golden '+v.name, () => {
  const fn = (order as unknown as Record<string, (...args: unknown[])=>unknown>)[v.function!];
  expect(fn!(...v.args)).toEqual(v.expected);
 });
 for (const v of vectors.cases.filter(v => !v.function)) it(v.name, () => {
  const [rows, source, before] = v.args as [Parameters<typeof planMove>[0], string, string | null];
  expect(planMove(rows, source, before)).toEqual(v.expected);
 });
 it.each([undefined, null, '3', [], {}, NaN, Infinity, -Infinity])('does not parse an invalid rank %s', value => expect(rankNumber(value)).toBeNull());
 it.each([0, -3, 0.5, 100])('keeps numeric ranks %s', value => expect(rankNumber(value)).toBe(value));
 it('sorts missing last and ties by full path without mutating input', () => {
  const rows = [{id:'z', rank:null}, {id:'b',rank:1}, {id:'a',rank:1}];
  expect(sortRows(rows).map(r=>r.id)).toEqual(['a','b','z']); expect(rows[0]!.id).toBe('z');
 });
 it('rejects unknown source', () => expect(()=>planMove([{id:'a',rank:1}], 'b', null)).toThrow());
 it('rejects unknown target', () => expect(()=>planMove([{id:'a',rank:1}], 'a', 'b')).toThrow());
 it('rejects duplicates', () => expect(()=>planMove([{id:'a',rank:1},{id:'a',rank:2}], 'a', null)).toThrow());
 it('rejects nonnumeric fields before writes', () => expect(()=>planMove([{id:'a',rank:'hello'},{id:'b',rank:2}], 'a', 'b')).toThrow('nonnumeric'));
 it('rebalances when floating point has no midpoint', () => {
  const writes = planMove([{id:'a',rank:1},{id:'b',rank:1+Number.EPSILON},{id:'c',rank:2}], 'c','b');
  expect(writes).toHaveLength(3); expect(writes.map(w=>w.id)).toEqual(['a','c','b']);
 });
 it('free always uses the default rank', () => expect(rankProperty('review_rank',false)).toBe('manual_order'));
 it('Pro uses a custom rank', () => expect(rankProperty('review_rank',true)).toBe('review_rank'));
 it.each(['file.name', '__proto__', 'constructor', 'prototype', '', 'rank/evil'])('validates custom names %s', name => {
  if (name === '') expect(rankProperty(name,true)).toBe('manual_order');
  else expect(()=>rankProperty(name,true)).toThrow();
 });
 it('persists one numeric property and keeps the note body and status', async () => {
  const app = App.createConfigured__({files:{'a.md':'---\nmanual_order: 1024\nstatus: todo\n---\nBody A', 'b.md':'---\nmanual_order: 2048\n---\nBody B'}});
  const [write] = planMove([{id:'a.md',rank:1024},{id:'b.md',rank:2048}],'b.md','a.md');
  const file = app.vault.getFileByPath('b.md')!;
  await app.fileManager.processFrontMatter(file, (fm: Record<string,unknown>) => {fm.manual_order=write!.rank;});
  expect(await app.vault.read(file)).toContain('manual_order: 0');
  expect(await app.vault.read(file)).toContain('Body B');
  expect(await app.vault.read(app.vault.getFileByPath('a.md')!)).toContain('status: todo');
 });
});

describe('minimal rank writes', () => {
 it('assigns only the moved new note when inserting it into an existing queue', () => {
  expect(planMove([{id:'a',rank:100},{id:'b',rank:200},{id:'c',rank:undefined}],'c','b')).toEqual([{id:'c',rank:150,previous:undefined}]);
 });
 it('appends missing notes after a negative maximum without rewriting ranked neighbors', () => {
  expect(planMove([{id:'a',rank:-2000},{id:'b',rank:-1000},{id:'c',rank:null}],'b','a')).toEqual([{id:'b',rank:-3024,previous:-1000},{id:'c',rank:24,previous:null}]);
 });
 it('keeps a no-op free of initialization writes', () => {
  expect(planMove([{id:'a',rank:1},{id:'b',rank:null}],'a','b')).toEqual([]);
 });
 it('rebalances finite ranks when appending at the numeric limit cannot advance', () => {
  const rows=[{id:'a',rank:Number.MAX_VALUE},{id:'b',rank:null},{id:'c',rank:null}];
  const writes=planMove(rows,'c','b');
  expect(writes.map(w=>w.rank)).toEqual([1024,2048,3072]);
 });
});
