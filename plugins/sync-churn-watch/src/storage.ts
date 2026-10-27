import type { Session, Row } from './watch';
/** Reject invalid saved sessions. Keep at most 30 stopped sessions. */
export function savedSessions(value: unknown): Session[] {
	if (!Array.isArray(value)) return [];
	const result: Session[] = [];
	for (const entry of value.slice(-30)) {
		if (!entry || typeof entry !== 'object') continue;
		const s = entry as Partial<Session>;
		if (typeof s.started !== 'number' || !Number.isFinite(s.started) || typeof s.stopped !== 'number' || !Number.isFinite(s.stopped) || s.stopped < s.started || !Array.isArray(s.rows)) continue;
		const rows = s.rows.filter((r: Row) => r && typeof r.path === 'string' && typeof r.name === 'string' && ['settings', 'vault'].includes(r.group) && Number.isInteger(r.writes) && r.writes >= 0 && Number.isFinite(r.bytes) && r.bytes >= 0);
		const days: Record<string, number> = {};
		if (s.days && typeof s.days === 'object') for (const [day, n] of Object.entries(s.days)) if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isInteger(n) && n >= 0) days[day] = n;
		result.push({ started: s.started, stopped: s.stopped, rows, days });
	}
	return result;
}
