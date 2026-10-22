// Pure logic of the "Task progress" view: count the tasks of one note, then sort and cap the note rows.
import { parseTaskLine, splitTaskLine, type TaskInfo } from './task';

export interface NoteProgress {
	/** Tasks with any status other than x, X and "-". */
	open: number;
	/** Tasks with status x or X. */
	done: number;
	/** Tasks with status "-". They are not part of open, done or total. */
	cancelled: number;
	/** open + done. */
	total: number;
	/** Whole percent of done / total, or null when total is 0. */
	percent: number | null;
	/** Earliest due date (YYYY-MM-DD) of an open task, or null. */
	nextDue: string | null;
	/** Open tasks with a due date before today. */
	overdue: number;
}

export type TaskState = 'open' | 'done' | 'cancelled';

/** x and X are done, "-" is cancelled, every other status is open. */
export function taskState(status: string): TaskState {
	if (status === 'x' || status === 'X') return 'done';
	if (status === '-') return 'cancelled';
	return 'open';
}

/**
 * Whole percent of done / total. It shows 100 only when every task is done, and 0 only when no task is done,
 * so one open task in 200 never reads as 100%.
 */
export function wholePercent(done: number, total: number): number | null {
	if (total <= 0) return null;
	const p = Math.round((done / total) * 100);
	if (done > 0 && p === 0) return 1;
	if (done < total && p === 100) return 99;
	return p;
}

/** Counts for one note from its parsed tasks. today is YYYY-MM-DD in local time. */
export function progressOf(tasks: Pick<TaskInfo, 'status' | 'dates'>[], today: string): NoteProgress {
	let open = 0;
	let done = 0;
	let cancelled = 0;
	let overdue = 0;
	let nextDue: string | null = null;
	for (const t of tasks) {
		const state = taskState(t.status);
		if (state === 'done') done++;
		else if (state === 'cancelled') cancelled++;
		else {
			open++;
			const due = t.dates.due;
			if (due) {
				if (nextDue === null || due < nextDue) nextDue = due;
				if (due < today) overdue++;
			}
		}
	}
	const total = open + done;
	return { open, done, cancelled, total, percent: wholePercent(done, total), nextDue, overdue };
}

/** Text of the Progress cell: "67%", or "" when the note has no tasks. */
export function progressText(p: Pick<NoteProgress, 'percent'>): string {
	return p.percent === null ? '' : `${p.percent}%`;
}

/**
 * 0-based numbers of the task lines outside fenced code blocks (``` or ~~~, also inside quotes and lists).
 * The view uses the metadata cache for this; this scan gives the same answer for plain notes without the app.
 */
export function taskLinesOutsideCode(content: string): number[] {
	const out: number[] = [];
	let fence: { char: string; len: number } | null = null;
	content.split('\n').forEach((line, i) => {
		const m = /^(?:[ \t]*>)*[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?(`{3,}|~{3,})(.*)$/.exec(line.replace(/\r$/, ''));
		if (fence) {
			if (m && m[1]![0] === fence.char && m[1]!.length >= fence.len && m[2]!.trim() === '') fence = null;
			return;
		}
		if (m && !(m[1]![0] === '`' && m[2]!.includes('`'))) {
			fence = { char: m[1]![0]!, len: m[1]!.length };
			return;
		}
		if (splitTaskLine(line)) out.push(i);
	});
	return out;
}

/**
 * Counts of one note from its text. taskLines are the task line numbers from the metadata cache; without them
 * the note is scanned with taskLinesOutsideCode. This is the function of the golden vectors.
 */
export function noteProgress(content: string, today: string, taskLines?: number[]): NoteProgress & { progress: string } {
	const lines = content.split('\n');
	const tasks: TaskInfo[] = [];
	for (const n of taskLines ?? taskLinesOutsideCode(content)) {
		const info = lines[n] === undefined ? null : parseTaskLine(lines[n]);
		if (info) tasks.push(info);
	}
	const p = progressOf(tasks, today);
	return { ...p, progress: progressText(p) };
}

export interface ProgressRow {
	path: string;
	/** Note name without the extension. */
	note: string;
	progress: NoteProgress;
}

export type ProgressSort = 'progress' | 'open' | 'due' | 'note';

export interface ProgressOptions {
	sort: ProgressSort;
	/** "Sort highest first": highest progress, most open tasks, latest due date, or Z to A. */
	descending: boolean;
	/** Keep notes with total 0. */
	showEmpty: boolean;
	/** Largest number of note rows; Infinity for no cap. */
	limit: number;
}

export interface ArrangedProgress {
	rows: ProgressRow[];
	/** Rows after the "Show notes without tasks" filter, before the cap. */
	matched: number;
}

const cmpText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
const byName = (a: ProgressRow, b: ProgressRow) => cmpText(a.note, b.note) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** Compares two values that can be missing. A missing value sorts last in both directions. */
function cmpMaybe<T extends string | number>(a: T | null, b: T | null, dir: number): number {
	if (a === b) return 0;
	if (a === null) return 1;
	if (b === null) return -1;
	return (a < b ? -1 : 1) * dir;
}

/** Filter, sort, then cap. The cap keeps the first rows in sort order. */
export function arrangeProgress(rows: ProgressRow[], o: ProgressOptions): ArrangedProgress {
	const dir = o.descending ? -1 : 1;
	const kept = o.showEmpty ? [...rows] : rows.filter((r) => r.progress.total > 0);
	const cmp = (a: ProgressRow, b: ProgressRow): number => {
		switch (o.sort) {
			case 'progress':
				return cmpMaybe(a.progress.percent, b.progress.percent, dir) || cmpMaybe(a.progress.done, b.progress.done, dir);
			case 'open':
				return (a.progress.open - b.progress.open) * dir;
			case 'due':
				return cmpMaybe(a.progress.nextDue, b.progress.nextDue, dir);
			case 'note':
				return byName(a, b) * dir;
		}
	};
	kept.sort((a, b) => cmp(a, b) || byName(a, b));
	return { rows: kept.slice(0, Math.max(0, o.limit)), matched: kept.length };
}
