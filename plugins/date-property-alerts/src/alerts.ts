/** Pure scheduling rules. Identity uses the raw date, never a local computed instant. */
export interface AlertInput { path: string; value: unknown }
export interface AlertRow { path: string; due: number; key: string }
export interface Delivery { delivered: boolean; snoozeUntil: number; dismissed?: boolean; silent?: boolean; updatedAt?: number }
export type Ledger = Record<string, Delivery>;
export const HISTORY_MS = 90 * 86400000;
export const FREE_SNOOZE_MINUTES = 15;

export function parseDue(value: unknown, hour = 9): number | null {
 if (typeof value !== 'string' || !Number.isInteger(hour) || hour < 0 || hour > 23) return null;
 const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/i.exec(value.trim());
 if (!m) return null;
 const y = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
 const h = m[4] === undefined ? hour : Number(m[4]), minute = Number(m[5] ?? 0), second = Number(m[6] ?? 0);
 const ms = Number((m[7] ?? '.0').slice(1).padEnd(3, '0'));
 const calendar = new Date(Date.UTC(y, month - 1, day));
 if (y < 100 || calendar.getUTCFullYear() !== y || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day || h > 23 || minute > 59 || second > 59) return null;
 const zone = m[8]?.toUpperCase();
 if (zone && zone !== 'Z') {
  const zh = Number(zone.slice(1, 3)), zm = Number(zone.slice(4));
  if (zh > 23 || zm > 59) return null;
 }
 const time = zone ? Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${String(second).padStart(2, '0')}.${String(ms).padStart(3, '0')}${zone}`) : new Date(y, month - 1, day, h, minute, second, ms).getTime();
 const local = new Date(time);
 // A date-only reminder moves forward over a DST gap. Explicit missing times are invalid.
 if (!zone && m[4] !== undefined && (local.getHours() !== h || local.getMinutes() !== minute)) return null;
 return Number.isFinite(time) ? time : null;
}

export function rowsFor(inputs: AlertInput[], property: string, hour = 9): { rows: AlertRow[]; invalid: number } {
 const rows: AlertRow[] = [], seen = new Set<string>();
 let invalid = 0;
 for (const input of inputs) {
  if (seen.has(input.path)) continue;
  seen.add(input.path);
  const due = parseDue(input.value, hour);
  if (due === null) { invalid++; continue; }
  const raw = (input.value as string).trim().replace(' ', 'T').replace(/t/g, 'T').replace(/z/g, 'Z');
  rows.push({ path: input.path, due, key: JSON.stringify([input.path, property, raw]) });
 }
 rows.sort((a, b) => a.due - b.due || a.path.localeCompare(b.path));
 return { rows, invalid };
}

/** Previously unknown past dates are visible, but do not produce a startup burst. */
export function observe(rows: AlertRow[], ledger: Ledger, startedAt: number, now: number): boolean {
 let changed = false;
 for (const row of rows) if (!ledger[row.key]) {
  ledger[row.key] = { delivered: false, snoozeUntil: 0, silent: row.due < startedAt, updatedAt: now };
  changed = true;
 }
 return changed;
}
export function ready(row: AlertRow, ledger: Ledger, now: number): boolean {
 const state = ledger[row.key];
 return row.due <= now && !state?.delivered && !state?.dismissed && !state?.silent && (state?.snoozeUntil ?? 0) <= now;
}
export function dueCount(rows: AlertRow[], ledger: Ledger, now: number): number {
 return rows.filter(r => r.due <= now && !ledger[r.key]?.delivered && !ledger[r.key]?.dismissed && (ledger[r.key]?.snoozeUntil ?? 0) <= now).length;
}
/** Call only after the user clicks the persistent notice. */
export function claim(rows: AlertRow[], ledger: Ledger, now: number): AlertRow[] {
 const out: AlertRow[] = [];
 for (const row of rows) if (ready(row, ledger, now)) {
  ledger[row.key] = { delivered: true, snoozeUntil: 0, updatedAt: now };
  out.push(row);
 }
 return out;
}
export function dismiss(row: AlertRow, ledger: Ledger, now: number): void {
 ledger[row.key] = { delivered: true, dismissed: true, snoozeUntil: 0, updatedAt: now };
}
export function snooze(row: AlertRow, ledger: Ledger, now: number, minutes: number, pro: boolean): boolean {
 if ((!pro && minutes !== FREE_SNOOZE_MINUTES) || !Number.isFinite(minutes) || minutes < 1 || minutes > 10080 || row.due > now) return false;
 ledger[row.key] = { delivered: false, snoozeUntil: now + minutes * 60000, updatedAt: now };
 return true;
}
export function pruneLedger(ledger: Ledger, now: number, exists: (path: string) => boolean): void {
 for (const [key, state] of Object.entries(ledger)) {
  let path: unknown;
  try { path = (JSON.parse(key) as unknown[])[0]; } catch { delete ledger[key]; continue; }
  if (typeof path !== 'string' || !exists(path) || (state.updatedAt ?? 0) < now - HISTORY_MS) delete ledger[key];
 }
}
export function normalizeLedger(raw: unknown, now = Date.now()): Ledger {
 const ledger: Ledger = Object.create(null) as Ledger;
 if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ledger;
 for (const [key, value] of Object.entries(raw)) {
  if (!value || typeof value !== 'object') continue;
  const s = value as Partial<Delivery>;
  if (typeof s.delivered === 'boolean' && typeof s.snoozeUntil === 'number' && Number.isFinite(s.snoozeUntil) && s.snoozeUntil >= 0) {
   ledger[key] = { delivered: s.delivered, snoozeUntil: s.snoozeUntil, updatedAt: typeof s.updatedAt === 'number' && Number.isFinite(s.updatedAt) ? s.updatedAt : now };
   if (s.dismissed === true) ledger[key].dismissed = true;
   if (typeof s.silent === 'boolean') ledger[key].silent = s.silent;
  }
 }
 return ledger;
}
