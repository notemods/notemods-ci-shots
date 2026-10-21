export type Cell = string | number | boolean | null;
export interface Row { id: string; values: Record<string, Cell> }
export interface GroupOptions { property: string; pro: boolean; period?: 'month' | 'iso-week'; newestFirst?: boolean; summaryProperty?: string; summaryMode?: 'sum' | 'average' }
export interface Group { key: string; label: string; property: string; count: number; summary: number | null; rows: string[]; children: Group[] }
const DAY = 86400000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function utc(year: number, month: number, day: number): Date {
 const result = new Date(0); result.setUTCFullYear(year, month - 1, day); return result;
}
/** Read the written calendar date. Do not shift a date into the machine time zone. */
export function parseDate(value: Cell | undefined): Date | null {
 if (typeof value !== 'string') return null;
 const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
 if (!match) return null;
 const y = Number(match[1]), m = Number(match[2]), d = Number(match[3]);
 if (y < 1 || m < 1 || m > 12 || d < 1 || d > 31) return null;
 if (match[4] && (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6] ?? 0) > 59)) return null;
 const offset = /[+-](\d{2}):(\d{2})$/.exec(value);
 if (offset && (Number(offset[1]) > 23 || Number(offset[2]) > 59)) return null;
 const date = utc(y, m, d);
 return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null;
}
function stamp(date: Date): string { return date.toISOString().slice(0, 10); }
export function isoWeek(date: Date): { year: number; week: number; start: string; end: string; order: number } {
 const monday = new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * DAY);
 const thursday = new Date(monday.getTime() + 3 * DAY);
 const year = thursday.getUTCFullYear();
 const jan4 = utc(year, 1, 4);
 const firstMonday = jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * DAY;
 return { year, week: Math.round((monday.getTime() - firstMonday) / (7 * DAY)) + 1, start: stamp(monday), end: stamp(new Date(monday.getTime() + 6 * DAY)), order: monday.getTime() };
}
export function summarize(rows: Row[], property: string | undefined, mode: 'sum' | 'average' = 'sum'): number | null {
 if (!property) return null;
 const values = rows.map((r) => r.values[property]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
 if (!values.length) return null;
 const sum = values.reduce((a, b) => a + b, 0);
 return mode === 'average' ? sum / values.length : sum;
}
export function buildGroups(input: Row[], options: GroupOptions): Group[] {
 if (!options.property) return [];
 const rows = [...new Map(input.map((r) => [r.id, r])).values()];
 const weeks = options.period === 'iso-week';
 const missing: Row[] = [];
 type Part = { id: string; label: string; order: number };
 const dated: { row: Row; parts: Part[] }[] = [];
 for (const row of rows) {
  const date = parseDate(row.values[options.property]);
  if (!date) { missing.push(row); continue; }
  const year = date.getUTCFullYear(), month = date.getUTCMonth();
  const week = isoWeek(date);
  dated.push({ row, parts: [
   { id: String(weeks ? week.year : year), label: String(weeks ? week.year : year), order: weeks ? week.year : year },
   weeks ? { id: String(week.week), label: `Week ${week.week} · ${week.start} to ${week.end}`, order: week.order } : { id: String(month + 1), label: MONTHS[month] ?? '', order: month },
   { id: stamp(date), label: stamp(date), order: date.getTime() },
  ] });
 }
 const make = (key: string, label: string, members: Row[], children: Group[]): Group => ({ key, label, property: options.property, count: members.length, summary: options.pro ? summarize(members, options.summaryProperty, options.summaryMode) : null, rows: members.map((r) => r.id), children });
 function build(items: typeof dated, depth: number, path: string[]): Group[] {
  if (depth === 3) return [];
  const buckets = new Map<string, { part: Part; items: typeof dated }>();
  for (const item of items) {
   const part = item.parts[depth]; if (!part) continue;
   let bucket = buckets.get(part.id);
   if (!bucket) { bucket = { part, items: [] }; buckets.set(part.id, bucket); }
   bucket.items.push(item);
  }
  return [...buckets.values()].sort((a, b) => (a.part.order - b.part.order) * (options.newestFirst === false ? 1 : -1)).map(({ part, items: members }) => {
   const next = [...path, part.id];
   return make(JSON.stringify([options.property, weeks ? 'iso-week' : 'month', ...next]), part.label, members.map((i) => i.row), build(members, depth + 1, next));
  });
 }
 const groups = build(dated, 0, []);
 if (missing.length) groups.push(make(JSON.stringify([options.property, 'no-date']), 'No date', missing, []));
 return groups;
}
