import { describe, expect, it } from 'vitest';
import { buildGroups, parseDate, isoWeek, summarize, type GroupOptions, type Row } from '../src/group';
import vectors from './vectors/bases-date-hierarchy.json';
const row = (id: string, date: Row['values'][string], hours?: number): Row => ({ id, values: { date, ...(hours === undefined ? {} : { hours }) } });
const opts = (extra: Partial<GroupOptions> = {}): GroupOptions => ({ property: 'date', pro: false, ...extra });
describe('golden acceptance cases', () => {
 for (const c of vectors.cases) it(c.name, () => expect(buildGroups(...c.args as [Row[], GroupOptions])).toEqual(c.expected));
});
describe('calendar edge cases', () => {
 for (const date of ['2026-02-29', '1900-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-01-00', '0000-01-01', '2026-1-2', '10/21/2026', '', '2026-01-01T25:00', '2026-01-01T00:60', '2026-01-01T00:00+99:00']) it(`rejects ${date || 'empty'}`, () => expect(parseDate(date)).toBeNull());
 it('accepts leap day divisible by 400', () => expect(parseDate('2000-02-29')?.getUTCDate()).toBe(29));
 it('accepts ordinary leap day', () => expect(parseDate('2024-02-29')?.getUTCDate()).toBe(29));
 it('keeps written date across time zones', () => expect(parseDate('2026-01-01T00:30:00+07:00')?.getUTCFullYear()).toBe(2026));
 it('handles years below 100', () => expect(parseDate('0099-01-01')?.getUTCFullYear()).toBe(99));
 for (const value of [null, false, 0, NaN, Infinity]) it(`rejects non-date ${String(value)}`, () => expect(parseDate(value)).toBeNull());
 it('empty data has no groups', () => expect(buildGroups([], opts())).toEqual([]));
 it('unconfigured property has no groups', () => expect(buildGroups([row('a', '2026-01-01')], opts({ property: '' }))).toEqual([]));
 it('deduplicates note paths', () => expect(buildGroups([row('a', '2026-01-01'), row('a', '2026-01-01')], opts())[0]?.count).toBe(1));
 it('keeps base row sorting within a day', () => expect(buildGroups([row('z', '2026-01-01'), row('a', '2026-01-01')], opts())[0]?.children[0]?.children[0]?.rows).toEqual(['z', 'a']));
 it('orders months by calendar instead of label', () => expect(buildGroups([row('a', '2026-04-01'), row('b', '2026-02-01')], opts({ newestFirst: false }))[0]?.children.map((g) => g.label)).toEqual(['February', 'April']));
 it('orders days newest first', () => expect(buildGroups([row('a', '2026-01-01'), row('b', '2026-01-02')], opts())[0]?.children[0]?.children.map((g) => g.label)).toEqual(['2026-01-02', '2026-01-01']));
 it('Sunday remains in the previous ISO week', () => expect(isoWeek(parseDate('2021-01-03')!)).toMatchObject({ year: 2020, week: 53, start: '2020-12-28', end: '2021-01-03' }));
 it('Monday begins the next ISO week', () => expect(isoWeek(parseDate('2021-01-04')!)).toMatchObject({ year: 2021, week: 1 }));
 it('December can belong to next week year', () => expect(isoWeek(parseDate('2025-12-31')!)).toMatchObject({ year: 2026, week: 1, start: '2025-12-29', end: '2026-01-04' }));
 it('average uses finite numbers only', () => expect(summarize([row('a', null, 0), row('b', null, 4), row('c', null, Infinity)], 'hours', 'average')).toBe(2));
 it('no numbers gives null', () => expect(summarize([row('a', null)], 'hours')).toBeNull());
 it('negative numbers contribute', () => expect(summarize([row('a', null, -2), row('b', null, 3)], 'hours')).toBe(1));
 it('missing property groups all notes at the end', () => expect(buildGroups([{ id: 'a', values: {} }], opts())[0]?.label).toBe('No date'));
 it('group paths distinguish mode and property', () => {
  const rows = [row('a', '2026-01-01')];
  expect(buildGroups(rows, opts())[0]?.key).not.toBe(buildGroups(rows, opts({ pro: true, period: 'iso-week' }))[0]?.key);
 });
});
for (const separator of [' ', 'T']) it(`accepts datetime with ${separator === ' ' ? 'space' : 'T'}`, () => expect(parseDate(`2026-10-21${separator}10:00`)?.toISOString()).toBe('2026-10-21T00:00:00.000Z'));
it('free week mode crosses the ISO year boundary without Pro', () => expect(buildGroups([row('a', '2025-12-31')], opts({ period: 'iso-week' }))[0]?.children[0]?.label).toBe('Week 1 · 2025-12-29 to 2026-01-04'));
