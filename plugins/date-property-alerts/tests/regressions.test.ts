import { afterEach, describe, expect, it } from 'vitest';
import { claim, dismiss, dueCount, HISTORY_MS, normalizeLedger, observe, parseDue, pruneLedger, ready, rowsFor, snooze, type Ledger } from '../src/alerts';

const timezone = process.env.TZ;
afterEach(() => { if (timezone === undefined) delete process.env.TZ; else process.env.TZ = timezone; });
const now = Date.parse('2026-10-21T10:00:00Z');
const row = (value = '2026-10-21T09:00:00Z', hour = 9) => rowsFor([{path:'Review.md',value}], 'note.due', hour).rows[0]!;

describe('review regressions', () => {
 it('preserves identity when date-only hour changes', () => {
  const a=row('2026-10-21',8), b=row('2026-10-21',12), ledger:Ledger={};
  claim([a],ledger,Infinity); expect(b.key).toBe(a.key); expect(ready(b,ledger,Infinity)).toBe(false);
 });
 it('preserves identity after timezone travel', () => {
  process.env.TZ='UTC'; const a=row('2026-10-21'); const ledger:Ledger={}; claim([a],ledger,now);
  process.env.TZ='America/New_York'; const b=row('2026-10-21');
  expect(a.due).not.toBe(b.due); expect(a.key).toBe(b.key); expect(ready(b,ledger,now+86400000)).toBe(false);
 });
 it('preserves dismissal across hour and timezone changes', () => {
  const a=row('2026-10-21',8), ledger:Ledger={}; dismiss(a,ledger,now);
  process.env.TZ='Pacific/Auckland'; const b=row('2026-10-21',15);
  expect(ledger[b.key]?.dismissed).toBe(true);
 });
 it('normalizes whitespace and T/Z case without changing identity', () => { expect(row(' 2026-10-21t09:00:00z ').key).toBe(row().key); });
 it('shows past dates on startup without notifying them', () => {
  const ledger:Ledger={}; observe([row()],ledger,now,now);
  expect(ready(row(),ledger,now)).toBe(false); expect(dueCount([row()],ledger,now)).toBe(1); expect(ledger[row().key]?.delivered).toBe(false);
 });
 it('keeps startup suppression after an hour change', () => {
  const ledger:Ledger={}; observe([row('2020-01-01',8)],ledger,now,now);
  expect(ready(row('2020-01-01',12),ledger,now)).toBe(false);
 });
 it('notifies a known future row when it comes due', () => {
  const r=row('2026-10-21T11:00Z'), ledger:Ledger={}; observe([r],ledger,now,now);
  expect(ready(r,ledger,r.due-1)).toBe(false); expect(ready(r,ledger,r.due)).toBe(true);
 });
 it('preserves a future observation through storage normalization', () => {
  const ledger:Ledger={}; observe([row('2099-01-01')],ledger,now,now);
  expect(normalizeLedger(JSON.parse(JSON.stringify(ledger)))).toEqual(ledger);
 });
 it('restores startup baseline and delivered state', () => {
  const ledger:Ledger={}; observe([row()],ledger,now,now);
  expect(ready(row(),normalizeLedger(JSON.parse(JSON.stringify(ledger))),now+86400000)).toBe(false);
 });
 it('dismiss hides the row independently of delivery', () => {
  const ledger:Ledger={}; claim([row()],ledger,now); expect(ledger[row().key]?.dismissed).not.toBe(true);
  dismiss(row(),ledger,now); expect(ledger[row().key]?.dismissed).toBe(true);
 });
 it('due count excludes delivered, dismissed and sleeping rows', () => {
  const rows=['08','09','10','11'].map(h=>row(`2026-10-21T${h}:00Z`)), ledger:Ledger={};
  claim([rows[0]!],ledger,now); dismiss(rows[1]!,ledger,now); snooze(rows[2]!,ledger,now,15,false);
  expect(dueCount(rows,ledger,now)).toBe(0);
 });
 it('free offers a fixed fifteen minute snooze', () => { const ledger:Ledger={}; expect(snooze(row(),ledger,now,15,false)).toBe(true); expect(ready(row(),ledger,now+900000)).toBe(true); });
 it('free rejects a custom duration', () => { expect(snooze(row(),{},now,20,false)).toBe(false); });
 it('Pro accepts a custom duration', () => { expect(snooze(row(),{},now,23,true)).toBe(true); });
 it('snoozing a baseline date re-arms it', () => { const ledger:Ledger={}; observe([row()],ledger,now,now); snooze(row(),ledger,now,15,false); expect(ready(row(),ledger,now+900000)).toBe(true); });
 it('prunes delivery history older than ninety days', () => {
  const ledger:Ledger={}; dismiss(row(),ledger,now-HISTORY_MS-1); pruneLedger(ledger,now,()=>true); expect(ledger).toEqual({});
 });
 it('keeps recent history and pending snooze', () => { const ledger:Ledger={}; snooze(row(),ledger,now,15,false); pruneLedger(ledger,now,()=>true); expect(ledger[row().key]).toBeDefined(); });
 it('prunes deleted and renamed paths', () => { const ledger:Ledger={}; dismiss(row(),ledger,now); pruneLedger(ledger,now,()=>false); expect(ledger).toEqual({}); });
 it('prunes malformed legacy identity', () => { const ledger:Ledger={bad:{delivered:true,snoozeUntil:0,updatedAt:now}}; pruneLedger(ledger,now,()=>true); expect(ledger).toEqual({}); });
 it('moves a date-only hour forward over a DST gap', () => { process.env.TZ='America/New_York'; expect(parseDue('2026-03-08',2)).toBe(Date.parse('2026-03-08T07:00:00Z')); });
 it('rejects an explicit local time in a DST gap', () => { process.env.TZ='America/New_York'; expect(parseDue('2026-03-08T02:30')).toBeNull(); });
 it('accepts an explicit offset even during a local DST gap', () => { process.env.TZ='America/New_York'; expect(parseDue('2026-03-08T02:30:00.123-05:00')).toBe(Date.parse('2026-03-08T07:30:00.123Z')); });
 it.each(['.1','.12','.123'])('accepts fractional seconds %s', fraction => { expect(parseDue(`2026-10-21t09:00:00${fraction}z`)).toBe(Date.parse(`2026-10-21T09:00:00${fraction}Z`)); });
});
