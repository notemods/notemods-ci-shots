/** Pure rank planning. A normal move writes one note. Missing ranks are appended; exhausted gaps rebalance the visible group. */
export interface Row { id: string; rank: unknown }
export interface RankWrite { id: string; rank: number; previous: unknown }
export const DEFAULT_PROPERTY = 'manual_order';
export function rankNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
export function rankProperty(raw: unknown, pro: boolean): string {
	if (!pro || raw === undefined || raw === '') return DEFAULT_PROPERTY;
	if (typeof raw !== 'string') throw new Error('Use a plain note property name.');
	const name = raw.trim();
	if (!/^[A-Za-z_][A-Za-z0-9_-]{0,79}$/.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('Use a plain note property name with letters, numbers, underscores or hyphens.');
	return name;
}
export function sortRows(rows: Row[]): Row[] {
	return [...rows].sort((a, b) => {
		const x = rankNumber(a.rank), y = rankNumber(b.rank);
		if (x !== null && y !== null && x !== y) return x < y ? -1 : 1;
		if (x === null && y !== null) return 1;
		if (y === null && x !== null) return -1;
		return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
	});
}
/** Move before a target, or to the end with null. Reject duplicates and unknown paths. */
export function planMove(rows: Row[], source: string, before: string | null): RankWrite[] {
	if (new Set(rows.map(r => r.id)).size !== rows.length) throw new Error('Duplicate notes in this group.');
	const old = sortRows(rows);
	if (!old.some(r => r.id === source) || (before !== null && !old.some(r => r.id === before))) throw new Error('The notes changed. Try the move again.');
	if (source === before) return [];
	const next = old.filter(r => r.id !== source);
	const index = before === null ? next.length : next.findIndex(r => r.id === before);
	const moved = old.find(r => r.id === source)!;
	next.splice(index, 0, moved);
	if (next.every((r, i) => r.id === old[i]?.id)) return [];
	// Never silently replace a text, list or object property selected by mistake.
	if (rows.some(r => r.rank !== undefined && r.rank !== null && rankNumber(r.rank) === null)) throw new Error('The rank property contains a nonnumeric value. Choose a numeric property or repair that value first.');
	// Give only unranked notes a provisional rank after the maximum. The final
	// diff below combines initialization and insertion into one write per note.
	const initialized = new Map<string, number>();
	let maximum = old.reduce((max, row) => Math.max(max, rankNumber(row.rank) ?? -Infinity), -Infinity);
	if (maximum === -Infinity) maximum = 0;
	for (const row of old) {
		if (rankNumber(row.rank) !== null) continue;
		const appended = maximum + 1024;
		if (!Number.isFinite(appended) || appended <= maximum) break;
		initialized.set(row.id, appended); maximum = appended;
	}
	const original = new Map(old.map(row => [row.id, row.rank]));
	const prepared = next.map(row => ({ ...row, rank: initialized.get(row.id) ?? row.rank }));
	const others = prepared.filter(r => r.id !== source);
	const valid = others.every((r, i) => rankNumber(r.rank) !== null && (i === 0 || Number(r.rank) > Number(others[i - 1]!.rank)));
	const left = index > 0 ? rankNumber(prepared[index - 1]!.rank) : null;
	const right = index + 1 < next.length ? rankNumber(prepared[index + 1]!.rank) : null;
	const rank = left === null ? (right === null ? 1024 : right - 1024) : right === null ? left + 1024 : left / 2 + right / 2;
	if (valid && Number.isFinite(rank) && (left === null || rank > left) && (right === null || rank < right)) {
		return prepared.flatMap(row => {
			const value = row.id === source ? rank : row.rank;
			return value === original.get(row.id) ? [] : [{ id: row.id, rank: value as number, previous: original.get(row.id) }];
		});
	}
	return next.flatMap((r, i) => r.rank === (i + 1) * 1024 ? [] : [{ id: r.id, rank: (i + 1) * 1024, previous: r.rank }]);
}
