// Pure row logic: collect the tasks of one note, then filter, sort, group and cap them for the view.
import { PRIORITY_NONE, parseTaskLine, splitTaskLine, type TaskInfo } from './task';

export const FREE_LIMIT = 200;

export interface TaskRow {
	/** path#line, unique inside one result. */
	id: string;
	path: string;
	note: string;
	/** 0-based line number in the file. */
	line: number;
	/** The exact line text when it was read, with a trailing "\r" for CRLF files. Writes compare against it. */
	raw: string;
	/** Nearest heading above the task, or "" when there is none. */
	heading: string;
	info: TaskInfo;
}

export interface CacheListItem {
	line: number;
	task?: string;
}

export interface CacheHeading {
	line: number;
	heading: string;
}

/**
 * Tasks of one note. listItems come from the metadata cache (it knows which lines are tasks and skips code
 * blocks); the text of each line comes from the file. A line the cache calls a task that no longer parses as one
 * (the file changed since the cache) is skipped.
 */
export function collectTasks(path: string, note: string, content: string, items: CacheListItem[], headings: CacheHeading[]): TaskRow[] {
	const lines = content.split('\n');
	const heads = [...headings].sort((a, b) => a.line - b.line);
	const rows: TaskRow[] = [];
	let h = -1;
	const taskLines = items.filter((i) => typeof i.task === 'string').map((i) => i.line);
	taskLines.sort((a, b) => a - b);
	for (const line of taskLines) {
		const raw = lines[line];
		if (raw === undefined || !splitTaskLine(raw)) continue;
		while (h + 1 < heads.length && heads[h + 1]!.line < line) h++;
		const info = parseTaskLine(raw);
		if (!info) continue;
		rows.push({ id: `${path}#${line}`, path, note, line, raw, heading: h >= 0 ? heads[h]!.heading : '', info });
	}
	return rows;
}

export type StatusFilter = 'open' | 'done' | 'all';
export type SortKey = 'file' | 'due' | 'scheduled' | 'priority' | 'text' | 'note';
export type GroupKey = 'none' | 'note' | 'heading' | 'tag' | 'date';
export type Bucket = 'overdue' | 'today' | 'week' | 'later' | 'none' | 'done';

export const BUCKET_LABEL: Record<Bucket, string> = {
	overdue: 'Overdue',
	today: 'Today',
	week: 'Next 7 days',
	later: 'Later',
	none: 'No date',
	done: 'Done',
};
const BUCKET_ORDER: Bucket[] = ['overdue', 'today', 'week', 'later', 'none', 'done'];

/** YYYY-MM-DD plus n days, in UTC so time zones and summer time never shift the day. */
export function addDays(day: string, n: number): string {
	const [y, m, d] = day.split('-').map(Number) as [number, number, number];
	return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Date group of a task: by its due date, else its scheduled date. Closed tasks go to Done. */
export function bucketOf(info: TaskInfo, today: string): Bucket {
	if (info.done) return 'done';
	const date = info.dates.due ?? info.dates.scheduled;
	if (!date) return 'none';
	if (date < today) return 'overdue';
	if (date === today) return 'today';
	if (date <= addDays(today, 7)) return 'week';
	return 'later';
}

export interface ArrangeOptions {
	status: StatusFilter;
	query: string;
	sort: SortKey;
	descending: boolean;
	group: GroupKey;
	/** Largest number of rows shown; Infinity for no cap. */
	limit: number;
	today: string;
}

export interface RowGroup {
	key: string;
	label: string;
	rows: TaskRow[];
}

export interface Arranged {
	groups: RowGroup[];
	/** Rows after the filter, before the cap. */
	matched: number;
	/** Rows on screen (a task with two tags is counted once). */
	shown: number;
}

const byFile = (a: TaskRow, b: TaskRow) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line);
const cmpText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

/** Compares two optional dates; a missing date always sorts last, whatever the direction. */
function cmpDate(a: string | undefined, b: string | undefined, dir: number): number {
	if (a === b) return 0;
	if (a === undefined) return 1;
	if (b === undefined) return -1;
	return (a < b ? -1 : 1) * dir;
}

export function sortRows(rows: TaskRow[], sort: SortKey, descending: boolean): TaskRow[] {
	const dir = descending ? -1 : 1;
	const cmp = (a: TaskRow, b: TaskRow): number => {
		switch (sort) {
			case 'due':
				return cmpDate(a.info.dates.due, b.info.dates.due, dir);
			case 'scheduled':
				return cmpDate(a.info.dates.scheduled, b.info.dates.scheduled, dir);
			case 'priority':
				return (b.info.priority - a.info.priority) * dir;
			case 'text':
				return cmpText(a.info.text, b.info.text) * dir;
			case 'note':
				return cmpText(a.note, b.note) * dir;
			case 'file':
				return byFile(a, b) * dir;
		}
	};
	return [...rows].sort((a, b) => cmp(a, b) || byFile(a, b));
}

function matches(row: TaskRow, status: StatusFilter, words: string[]): boolean {
	if (status === 'open' && row.info.done) return false;
	if (status === 'done' && !row.info.done) return false;
	if (!words.length) return true;
	const hay = `${row.info.text} ${row.info.tags.map((t) => `#${t}`).join(' ')} ${row.note} ${row.heading}`.toLowerCase();
	return words.every((w) => hay.includes(w));
}

function groupKeys(row: TaskRow, group: GroupKey, today: string): Array<[string, string]> {
	switch (group) {
		case 'none':
			return [['', '']];
		case 'note':
			return [[row.path, row.note]];
		case 'heading':
			return [[`${row.path}#${row.heading}`, row.heading ? `${row.note} › ${row.heading}` : `${row.note} (no heading)`]];
		case 'tag':
			return row.info.tags.length ? row.info.tags.map((t) => [`#${t}`, `#${t}`]) : [['', 'No tag']];
		case 'date': {
			const b = bucketOf(row.info, today);
			return [[b, BUCKET_LABEL[b]]];
		}
	}
}

/** Filter, sort, cap, then group. The cap keeps the first rows in sort order. */
export function arrangeRows(rows: TaskRow[], o: ArrangeOptions): Arranged {
	const words = o.query.toLowerCase().split(/\s+/).filter(Boolean);
	const kept = sortRows(
		rows.filter((r) => matches(r, o.status, words)),
		o.sort,
		o.descending,
	);
	const capped = kept.slice(0, Math.max(0, o.limit));
	const map = new Map<string, RowGroup>();
	for (const row of capped) {
		for (const [key, label] of groupKeys(row, o.group, o.today)) {
			let g = map.get(key);
			if (!g) map.set(key, (g = { key, label, rows: [] }));
			g.rows.push(row);
		}
	}
	let groups = [...map.values()];
	if (o.group === 'date') groups.sort((a, b) => BUCKET_ORDER.indexOf(a.key as Bucket) - BUCKET_ORDER.indexOf(b.key as Bucket));
	else if (o.group === 'tag') groups.sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : cmpText(a.label, b.label)));
	else if (o.group !== 'none') groups.sort((a, b) => cmpText(a.label, b.label));
	return { groups, matched: kept.length, shown: capped.length };
}

/** Priority text for a cell, "" for normal. */
export function priorityText(p: number): string {
	return p === PRIORITY_NONE ? '' : (['Lowest', 'Low', '', 'Medium', 'High', 'Highest'][p] ?? '');
}
