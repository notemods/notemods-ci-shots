import { describe, expect, it } from 'vitest';
import { claim, normalizeLedger, parseDue, ready, rowsFor, snooze, type Ledger } from '../src/alerts';
import vectors from './vectors/date-property-alerts.json';

describe('ISO dates', () => {
 it.each(vectors.cases)('$name', c => {
  const f = { parseDue, ready, rowsFor, claim, snooze }[('function' in c ? c.function : 'parseDue') as 'parseDue'];
  expect((f as (...args: unknown[]) => unknown)(...structuredClone(c.args))).toEqual(c.expected);
 });
 it('uses local hour for dates', () => { expect(parseDue('2026-10-21', 13)).toBe(new Date(2026, 9, 21, 13).getTime()); });
 it('uses 9 as the default date hour', () => { expect(parseDue('2026-10-21')).toBe(new Date(2026, 9, 21, 9).getTime()); });
 it('uses local time when unzoned', () => { expect(parseDue('2026-10-21 15:22')).toBe(new Date(2026, 9, 21, 15, 22).getTime()); });
 it('rejects invalid hour configuration', () => { expect(parseDue('2026-10-21', 24)).toBeNull(); });
 it('rejects fractional hour configuration', () => { expect(parseDue('2026-10-21', 9.5)).toBeNull(); });
});

describe('filtered row scheduling', () => {
 const now = Date.parse('2026-10-21T10:00:00Z');
 const due = { path: 'A.md', value: '2026-10-21T09:00:00Z' };
 const row = rowsFor([due], 'note.due').rows[0]!;
 it('sorts by instant and counts invalid rows', () => { const r = rowsFor([{path:'B.md',value:'2026-11-01T09:00Z'},due,{path:'C.md',value:null}], 'note.due'); expect(r.rows.map(x=>x.path)).toEqual(['A.md','B.md']); expect(r.invalid).toBe(1); });
 it('does not add absent input rows', () => { expect(rowsFor([due], 'note.due').rows.map(r=>r.path)).toEqual(['A.md']); });
 it('collapses duplicate paths', () => { expect(rowsFor([due,due], 'note.due').rows).toHaveLength(1); });
 it('claims overdue once', () => { const l: Ledger = {}; expect(claim([row],l,now)).toHaveLength(1); expect(claim([row],l,now)).toEqual([]); });
 it('claims exact boundary', () => { expect(ready(row,{},row.due)).toBe(true); });
 it('does not claim the future', () => { expect(claim([row],{},row.due-1)).toEqual([]); });
 it('deduplicates across sources', () => { const l: Ledger = {}; claim([row],l,now); expect(claim(rowsFor([due], 'note.due').rows,l,now)).toEqual([]); });
 it('a changed instant re-arms', () => { const l: Ledger = {}; claim([row],l,now); const changed=rowsFor([{...due,value:'2026-10-21T09:30Z'}], 'note.due').rows; expect(claim(changed,l,now)).toHaveLength(1); });
 it('properties have distinct identities', () => { expect(rowsFor([due], 'note.review').rows[0]!.key).not.toBe(row.key); });
 it('paths with separators do not collide', () => { expect(rowsFor([{...due,path:'A|B.md'}],'note.due').rows[0]!.key).not.toBe(row.key); });
 it('different raw dates have distinct identities', () => { expect(rowsFor([{...due,value:'2026-10-21T10:00:00+01:00'}],'note.due').rows[0]!.key).not.toBe(row.key); });
 it('restores delivery after restart', () => { const l: Ledger = {}; claim([row],l,now); expect(ready(row,normalizeLedger(JSON.parse(JSON.stringify(l))),now)).toBe(false); });
 it('permits Pro snooze', () => { const l: Ledger = {}; expect(snooze(row,l,now,15,true)).toBe(true); expect(ready(row,l,now+899999)).toBe(false); expect(ready(row,l,now+900000)).toBe(true); });
 it('gates free snooze without state mutation', () => { const l: Ledger = {}; expect(snooze(row,l,now,60,false)).toBe(false); expect(l).toEqual({}); });
 it('snooze re-delivers only once', () => { const l: Ledger = {}; claim([row],l,now); snooze(row,l,now,60,true); expect(claim([row],l,now+3600000)).toHaveLength(1); expect(claim([row],l,now+3600001)).toEqual([]); });
 it('existing snooze completes without a license check', () => { const l: Ledger = {}; snooze(row,l,now,1,true); expect(ready(row,normalizeLedger(l),now+60000)).toBe(true); });
 it.each([0,-1,Infinity,NaN,10081])('rejects invalid snooze %s', minutes => { expect(snooze(row,{},now,minutes,true)).toBe(false); });
 it('cannot snooze an upcoming date', () => { expect(snooze(row,{},row.due-1,15,true)).toBe(false); });
 it('does not modify input values', () => { const before=JSON.stringify(due); rowsFor([due], 'note.due'); expect(JSON.stringify(due)).toBe(before); });
 it('normalizes corrupt state', () => { expect(normalizeLedger({a:null,b:{delivered:1},c:{delivered:true,snoozeUntil:-1},d:{delivered:false,snoozeUntil:NaN}})).toEqual({}); });
 it.each([null,[],4,'bad'])('handles malformed ledger %s', value => { expect(normalizeLedger(value)).toEqual({}); });
});
