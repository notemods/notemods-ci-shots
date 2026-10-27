export interface Version { text: string; capturedAt: number }
export interface Draft {
	id: string;
	board: string;
	lane: string;
	text: string;
	updatedAt: number;
	versions: Version[];
}
export interface BoardLimit { drafts: number; days: number; versions: number }
export interface DraftSettings { drafts: Draft[]; limits: Record<string, BoardLimit> }
export interface Capture { id: string; board: string; lane: string; text: string; at: number }
export const DEFAULT_LIMIT: BoardLimit = { drafts: 100, days: 30, versions: 10 };
export const DAY_MS = 86400000;

function object(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function bounded(value: unknown, fallback: number, max: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.min(max, Math.round(value))) : fallback;
}
export function normalizeLimit(value: unknown): BoardLimit {
	const v = object(value);
	return { drafts: bounded(v.drafts, 100, 500), days: bounded(v.days, 30, 3650), versions: bounded(v.versions, 10, 50) };
}
export function normalizeSettings(value: unknown): DraftSettings {
	const v = object(value);
	const seen = new Set<string>();
	const drafts: Draft[] = [];
	for (const raw of Array.isArray(v.drafts) ? v.drafts : []) {
		const d = object(raw);
		if (typeof d.id !== 'string' || !d.id || seen.has(d.id) || typeof d.board !== 'string' || !d.board || typeof d.text !== 'string' || !d.text.trim()) continue;
		seen.add(d.id);
		const versions: Version[] = [];
		for (const entry of Array.isArray(d.versions) ? d.versions : []) {
			const h = object(entry);
			if (typeof h.text === 'string' && h.text.trim() && typeof h.capturedAt === 'number' && Number.isFinite(h.capturedAt)) versions.push({ text: h.text, capturedAt: h.capturedAt });
		}
		drafts.push({ id: d.id, board: d.board, lane: typeof d.lane === 'string' ? d.lane : 'Unknown lane', text: d.text, updatedAt: typeof d.updatedAt === 'number' && Number.isFinite(d.updatedAt) ? d.updatedAt : 0, versions: versions.slice(0, 50) });
	}
	return { drafts, limits: Object.fromEntries(Object.entries(object(v.limits)).map(([path, limit]) => [path, normalizeLimit(limit)])) };
}
export function boardLimit(settings: DraftSettings, path: string): BoardLimit {
	return Object.prototype.hasOwnProperty.call(settings.limits, path) ? settings.limits[path]! : DEFAULT_LIMIT;
}
export function retain(settings: DraftSettings, now: number, pro: boolean): DraftSettings {
	if (!pro) return settings;
	const counts = new Map<string, number>();
	const drafts = [...settings.drafts].sort((a, b) => b.updatedAt - a.updatedAt).filter((d) => {
		const limit = boardLimit(settings, d.board);
		const count = counts.get(d.board) ?? 0;
		if (d.updatedAt < now - limit.days * DAY_MS || count >= limit.drafts) return false;
		counts.set(d.board, count + 1);
		return true;
	}).map((d) => ({ ...d, versions: d.versions.filter((h) => h.capturedAt >= now - boardLimit(settings, d.board).days * DAY_MS).slice(0, boardLimit(settings, d.board).versions) }));
	return { ...settings, drafts };
}
export const BURST_MS = 5000;
/** Adds the previous text as a version. One typing burst at the end of the text keeps its longest text as one version, not one version for each keystroke. */
function snapshot(old: Draft): Version[] {
	const previous: Version = { text: old.text, capturedAt: old.updatedAt };
	const newest = old.versions[0];
	if (newest && old.updatedAt - newest.capturedAt < BURST_MS) {
		if (newest.text.startsWith(old.text)) return old.versions;
		if (old.text.startsWith(newest.text)) return [previous, ...old.versions.slice(1)];
	}
	return [previous, ...old.versions];
}
export function captureDraft(settings: DraftSettings, input: Capture, pro: boolean): DraftSettings {
	if (!input.text.trim() || !input.id || !input.board) return settings;
	const old = settings.drafts.find((d) => d.id === input.id);
	if (old && (old.board !== input.board || old.text === input.text)) return settings;
	const versions = old ? (pro ? snapshot(old).slice(0, boardLimit(settings, input.board).versions) : old.versions) : [];
	const draft: Draft = { id: input.id, board: input.board, lane: old?.lane ?? input.lane, text: input.text, updatedAt: input.at, versions };
	return retain({ ...settings, drafts: [draft, ...settings.drafts.filter((d) => d.id !== input.id)] }, input.at, pro);
}
export function dismissDraft(settings: DraftSettings, id: string): DraftSettings {
	return { ...settings, drafts: settings.drafts.filter((d) => d.id !== id) };
}
export function findDrafts(settings: DraftSettings, query: string, pro: boolean): Draft[] {
	const needle = pro ? query.trim().toLocaleLowerCase() : '';
	return settings.drafts.filter((d) => !needle || `${d.board}\n${d.lane}\n${d.text}`.toLocaleLowerCase().includes(needle)).sort((a, b) => b.updatedAt - a.updatedAt);
}
