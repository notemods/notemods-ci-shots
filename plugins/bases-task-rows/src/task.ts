// Pure task line logic: parse one Markdown checklist line and edit it without touching any other byte.
// A line is kept as head + status + "]" + tail. Every edit changes only the status character or one date
// token, so serialize(parse(line)) === line for any line, with Tasks emoji dates or Dataview fields.

export type DateField = 'due' | 'scheduled' | 'start' | 'done' | 'created' | 'cancelled';
export type DateStyle = 'emoji' | 'dataview';
/** When a tick adds a done date: never, always, or only when the line already carries a date. */
export type DoneDateMode = 'never' | 'always' | 'auto';

export const DATE_FIELDS: readonly DateField[] = ['due', 'scheduled', 'start', 'done', 'created', 'cancelled'];

export interface TaskLine {
	/** Everything before the status character: indent, quote marks, list marker, space and "[". */
	head: string;
	/** The character inside the brackets. */
	status: string;
	/** Everything after "]". */
	tail: string;
}

export interface TaskInfo {
	status: string;
	done: boolean;
	text: string;
	dates: Partial<Record<DateField, string>>;
	priority: number;
	tags: string[];
	recurrence: string | null;
}

/** Priority values, high to low. 2 is a task with no priority, like the Tasks plugin orders them. */
export const PRIORITY_NONE = 2;
const PRIORITY_EMOJI: Record<string, number> = { '🔺': 5, '⏫': 4, '🔼': 3, '🔽': 1, '⏬': 0 };
const PRIORITY_WORD: Record<string, number> = { highest: 5, high: 4, medium: 3, normal: 2, none: 2, low: 1, lowest: 0 };
export const PRIORITY_LABEL: Record<number, string> = { 5: 'Highest', 4: 'High', 3: 'Medium', 2: '', 1: 'Low', 0: 'Lowest' };

const LINE = /^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[)([^\]\r\n])\]([^\n]*)$/;
const DATE = String.raw`(\[\[\d{4}-\d{2}-\d{2}\]\]|\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?(?![\p{L}\p{N}_-])`;
const VS = '\\uFE0F?';
const EMOJI: Record<DateField, string> = {
	due: '(?:📅|📆|🗓)',
	scheduled: '(?:⏳|⌛)',
	start: '🛫',
	done: '✅',
	created: '➕',
	cancelled: '❌',
};
/** The emoji a new date of each field gets. */
const EMOJI_OUT: Record<DateField, string> = { due: '📅', scheduled: '⏳', start: '🛫', done: '✅', created: '➕', cancelled: '❌' };
/** Dataview field names per date field. The first name is used for new fields. */
const DV_KEYS: Record<DateField, string[]> = {
	due: ['due'],
	scheduled: ['scheduled'],
	start: ['start'],
	done: ['completion', 'done'],
	created: ['created'],
	cancelled: ['cancelled'],
};

const emojiDate = (f: DateField) => new RegExp(`(^|[ \\t])${EMOJI[f]}${VS}[ \\t]*${DATE}`, 'u');
const dvDate = (f: DateField) => new RegExp(`(^|[ \\t])([[(])[ \\t]*(?:${DV_KEYS[f].join('|')})[ \\t]*::[ \\t]*${DATE}[ \\t]*[\\])]`, 'iu');
const EMOJI_RE = Object.fromEntries(DATE_FIELDS.map((f) => [f, emojiDate(f)])) as Record<DateField, RegExp>;
const DV_RE = Object.fromEntries(DATE_FIELDS.map((f) => [f, dvDate(f)])) as Record<DateField, RegExp>;
const ANY_EMOJI_DATE = /(?:📅|📆|🗓|⏳|⌛|🛫|✅|➕|❌)️?[ \t]*\d{4}-\d{2}-\d{2}/u;
const ANY_DV_FIELD = /[[(][ \t]*[\p{L}\p{N}_-]+[ \t]*::/u;
const DV_FIELD_ALL = /(^|[ \t])[[(][ \t]*([\p{L}\p{N}_ -]+?)[ \t]*::[ \t]*([^\])\r\n]*)[\])]/gu;
const PRIORITY_RE = /(^|[ \t])(🔺|⏫|🔼|🔽|⏬)️?(?=[ \t]|$)/u;
const SIGNS = '📅📆🗓⏳⌛🛫✅➕❌🔺⏫🔼🔽⏬🆔⛔🏁🔁';
const RECUR_RE = new RegExp(`(^|[ \\t])🔁${VS}[ \\t]*([^${SIGNS}[(^]*?)(?=[ \\t]+[${SIGNS}[(^#]|[ \\t]*$)`, 'u');
const ID_RE = new RegExp(`(^|[ \\t])(?:🆔|⛔|🏁)${VS}[ \\t]*[^ \\t${SIGNS}]+`, 'gu');
const TAG_RE = /(^|[ \t])#([^\s#,.;:!?()[\]{}"'`|\\^=<>]+)/gu;
const BLOCK_ID = /([ \t]+\^[A-Za-z0-9-]+)[ \t]*$/;

/** Code spans use a matching run of backticks. Keep offsets for edits to the original line. */
function codeRanges(text: string): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	let i = 0;
	while (i < text.length) {
		const start = text.indexOf('`', i);
		if (start < 0) break;
		let end = start;
		while (text[end] === '`') end++;
		const length = end - start;
		let next = end;
		let closed = false;
		while ((next = text.indexOf('`', next)) >= 0) {
			let stop = next;
			while (text[stop] === '`') stop++;
			if (stop - next === length) {
				ranges.push([start, stop]);
				i = stop;
				closed = true;
				break;
			}
			next = stop;
		}
		if (!closed) i = end;
	}
	return ranges;
}

function withoutCode(text: string): string {
	let out = '';
	let start = 0;
	for (const [from, to] of codeRanges(text)) {
		out += text.slice(start, from) + ' '.repeat(to - from);
		start = to;
	}
	return out + text.slice(start);
}

/** Accept only dates on the Gregorian calendar. Date.UTC treats years 0 to 99 specially. */
export function isValidDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const [year, month, day] = value.split('-').map(Number) as [number, number, number];
	const date = new Date(0);
	date.setUTCFullYear(year, month - 1, day);
	return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Splits a checklist line. Null when the line is not a task. A trailing "\r" stays in tail. */
export function splitTaskLine(line: string): TaskLine | null {
	const m = LINE.exec(line);
	if (!m) return null;
	return { head: m[1]!, status: m[2]!, tail: m[3]! };
}

export function joinTaskLine(t: TaskLine): string {
	return `${t.head}${t.status}]${t.tail}`;
}

/** x and X are done. "-" (cancelled) counts as closed too, so it never shows as overdue. */
export function isDoneStatus(status: string): boolean {
	return status === 'x' || status === 'X' || status === '-';
}

function findDate(body: string, f: DateField): { value: string; style: DateStyle } | null {
	const match = findDateMatch(body, f);
	return match ? { value: match.value, style: match.style } : null;
}

function findDateMatch(body: string, f: DateField): { hit: RegExpExecArray; value: string; style: DateStyle } | null {
	const text = withoutCode(body);
	for (const [pattern, style, group] of [[EMOJI_RE[f], 'emoji', 2], [DV_RE[f], 'dataview', 3]] as const) {
		for (const hit of text.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))) {
			const value = hit[group]!.replace(/^\[\[|\]\]$/g, '');
			if (style === 'dataview' && ((hit[2] === '[') !== hit[0].endsWith(']'))) continue;
			if (isValidDate(value)) return { hit, value, style };
		}
	}
	return null;
}

function findPriority(body: string): number {
	const e = PRIORITY_RE.exec(body);
	if (e) return PRIORITY_EMOJI[e[2]!] ?? PRIORITY_NONE;
	for (const m of body.matchAll(DV_FIELD_ALL)) {
		if (m[2]!.trim().toLowerCase() !== 'priority') continue;
		return PRIORITY_WORD[m[3]!.trim().toLowerCase()] ?? PRIORITY_NONE;
	}
	return PRIORITY_NONE;
}

/** Tags in the body, without the "#", in order, no repeats. Pure numbers are not tags (same rule as the app). */
export function findTags(body: string): string[] {
	const out: string[] = [];
	for (const m of withoutCode(body).matchAll(TAG_RE)) {
		const tag = m[2]!.replace(/\/+$/, '');
		if (!tag || /^\d+$/.test(tag) || out.includes(tag)) continue;
		out.push(tag);
	}
	return out;
}

/** Task text for display: the body without dates, priority, fields, recurrence, ids, tags and block id. */
function displayText(body: string): string {
	const ranges = codeRanges(body);
	if (ranges.length) {
		let start = 0;
		let out = '';
		for (const [from, to] of ranges) {
			out += `${displayText(body.slice(start, from))} ${body.slice(from, to)} `;
			start = to;
		}
		return (out + displayText(body.slice(start))).trim();
	}
	let s = body.replace(/\r$/, '').replace(BLOCK_ID, '');
	for (const f of DATE_FIELDS) {
		for (let date = findDateMatch(s, f); date; date = findDateMatch(s, f)) {
			s = s.slice(0, date.hit.index) + date.hit[1]! + s.slice(date.hit.index + date.hit[0].length);
		}
	}
	s = s.replace(DV_FIELD_ALL, '$1').replace(new RegExp(PRIORITY_RE.source, 'gu'), '$1').replace(ID_RE, '$1').replace(RECUR_RE, '$1');
	s = s.replace(TAG_RE, (all: string, pre: string, tag: string) => (/^\d+$/.test(tag) ? all : pre));
	return s.replace(/[ \t]+/g, ' ').trim();
}

/** Reads the parts of a task line that the view shows. Null when the line is not a task. */
export function parseTaskLine(line: string): TaskInfo | null {
	const t = splitTaskLine(line);
	if (!t) return null;
	const body = withoutCode(t.tail);
	const dates: Partial<Record<DateField, string>> = {};
	for (const f of DATE_FIELDS) {
		const d = findDate(body, f);
		if (d) dates[f] = d.value;
	}
	const r = RECUR_RE.exec(body);
	return {
		status: t.status,
		done: isDoneStatus(t.status),
		text: displayText(t.tail),
		dates,
		priority: findPriority(body),
		tags: findTags(body),
		recurrence: r ? r[2]!.trim() || null : null,
	};
}

/** The style a new date on this line gets: the line's own style first, then the setting. */
export function styleFor(tail: string, fallback: DateStyle): DateStyle {
	tail = withoutCode(tail);
	if (DATE_FIELDS.some((f) => findDateMatch(tail, f)?.style === 'emoji')) return 'emoji';
	if (ANY_EMOJI_DATE.test(tail)) return 'emoji';
	if (ANY_DV_FIELD.test(tail)) return 'dataview';
	return fallback;
}

/** Sets, changes or removes one date in the text after "]". Only that token changes. */
export function setDateInTail(tail: string, f: DateField, value: string | null, fallback: DateStyle): string {
	if (value !== null && !isValidDate(value)) throw new Error(`not a valid YYYY-MM-DD date: ${value}`);
	const date = findDateMatch(tail, f);
	if (date) {
		const { hit } = date;
		const start = hit.index + hit[1]!.length;
		const end = hit.index + hit[0].length;
		if (value === null) return tail.slice(0, hit.index) + tail.slice(end);
		const token = tail.slice(start, end);
		const old = date.value;
		const at = token.indexOf(old);
		return tail.slice(0, start) + token.slice(0, at) + value + token.slice(at + old.length) + tail.slice(end);
	}
	if (value === null) return tail;
	const style = styleFor(tail, fallback);
	const token = style === 'emoji' ? `${EMOJI_OUT[f]} ${value}` : `[${DV_KEYS[f][0]!}:: ${value}]`;
	const cr = tail.endsWith('\r') ? '\r' : '';
	const body = cr ? tail.slice(0, -1) : tail;
	const block = BLOCK_ID.exec(body);
	const main = block ? body.slice(0, block.index) : body;
	const rest = block ? body.slice(block.index) : '';
	const trimmed = main.replace(/[ \t]+$/, '');
	return `${trimmed} ${token}${main.slice(trimmed.length)}${rest}${cr}`;
}

export type TaskEdit =
	| { type: 'none' }
	| { type: 'done'; today: string; doneDate?: DoneDateMode; style?: DateStyle }
	| { type: 'open'; doneDate?: DoneDateMode }
	| { type: 'date'; field: DateField; value: string | null; style?: DateStyle }
	| { type: 'today'; today: string; style?: DateStyle };

/** The date that puts a task in its date group: due first, then scheduled. */
export function bucketField(info: Pick<TaskInfo, 'dates'>): DateField | null {
	if (info.dates.due) return 'due';
	if (info.dates.scheduled) return 'scheduled';
	return null;
}

const addDays = (iso: string, n: number): string => {
	const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
	const t = new Date(Date.UTC(y, m - 1, d + n));
	return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};
const addMonths = (iso: string, n: number): string => {
	const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
	const t = new Date(Date.UTC(y, m - 1 + n, 1));
	const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
	const day = Math.min(d, last);
	return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(day)}`;
};
const pad = (n: number): string => String(n).padStart(2, '0');

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

/**
 * The next date of a recurrence rule, in the style of the Tasks plugin: "every N days|weeks|months|years",
 * "every day|week|month|year", "every monday" (and other weekday names), and "every N" for a number of days.
 * The base date is the due date, or the scheduled date when there is no due date. Words like "when done",
 * "starting", "every week on" plus a day list are accepted but the rule without them decides the step.
 * Null when the rule says nothing the plugin can count, or when there is no base date.
 */
export function nextRecurrenceDate(rule: string, base: string | undefined): string | null {
	if (!isValidDate(base ?? '')) return null;
	const SP1 = new RegExp(`^every[ \t]+`);
	const text = rule.toLowerCase().replace(SP1, '');
	let n = 1;
	let unit: 'day' | 'week' | 'month' | 'year' | null = null;
	const COUNT_RE = new RegExp(`^(?:every[ \t]+)?(\\d{1,3})[ \t]+(days?|weeks?|months?|years?)\\b`);
	const count = COUNT_RE.exec(rule.toLowerCase());
	if (count) {
		n = Number(count[1]);
		unit = count[2]!.replace(/s$/, '') as 'day' | 'week' | 'month' | 'year';
	} else if (new RegExp(`^(?:every[ \t]+)?\\d{1,3}$`).test(rule.trim())) {
		// A bare count is a number of days, in the style of the Tasks plugin.
		const SP2 = new RegExp(`^\\S+[ \t]+`);
		n = Number(rule.trim().replace(SP2, ''));
		unit = 'day';
	} else {
		const WORD_RE = new RegExp(`^(?:every[ \t]+)?(day|week|month|year)\\b`);
		const word = WORD_RE.exec(text);
		if (word) unit = word[1]! as 'day' | 'week' | 'month' | 'year';
		else {
			const wd = WEEKDAYS.findIndex((w) => text.startsWith(w) || text.startsWith(w.slice(0, 3)));
			if (wd < 0) return null;
			const [y, m, d] = (base as string).split('-').map(Number) as [number, number, number];
			const t = new Date(Date.UTC(y, m - 1, d));
			const delta = (wd - t.getUTCDay() + 7) % 7 || 7;
			return addDays(base as string, delta);
		}
	}
	const k = unit === 'day' ? n : unit === 'week' ? n * 7 : 0;
	if (k) return addDays(base as string, k);
	if (unit === 'month') return addMonths(base as string, n);
	return addMonths(base as string, n * 12);
}

/** Applies one edit to one task line. Returns null when the line is not a task. The rest of the line keeps every byte. */
export function editTaskLine(line: string, edit: TaskEdit): string | null {
	const t = splitTaskLine(line);
	if (!t) return null;
	switch (edit.type) {
		case 'none':
			return joinTaskLine(t);
		case 'done': {
			const mode = edit.doneDate ?? 'auto';
			const hadDate = DATE_FIELDS.some((f) => findDate(t.tail, f));
			const add = mode === 'always' || (mode === 'auto' && hadDate);
			const tail = add && !findDate(t.tail, 'done') ? setDateInTail(t.tail, 'done', edit.today, edit.style ?? 'emoji') : t.tail;
			return joinTaskLine({ head: t.head, status: 'x', tail });
		}
		case 'open': {
			const mode = edit.doneDate ?? 'auto';
			const tail = mode === 'never' ? t.tail : setDateInTail(t.tail, 'done', null, 'emoji');
			return joinTaskLine({ head: t.head, status: ' ', tail });
		}
		case 'date':
			return joinTaskLine({ ...t, tail: setDateInTail(t.tail, edit.field, edit.value, edit.style ?? 'emoji') });
		case 'today': {
			const info = parseTaskLine(line);
			const field = (info && bucketField(info)) ?? 'due';
			return joinTaskLine({ ...t, tail: setDateInTail(t.tail, field, edit.today, edit.style ?? 'emoji') });
		}
	}
}

/** One golden-vector step: edit a line, then read it back. */
export function editAndParse(line: string, edit: TaskEdit): { line: string | null; task: TaskInfo | null } {
	const next = editTaskLine(line, edit);
	return { line: next, task: next === null ? null : parseTaskLine(next) };
}

/** Whole days from date a to date b (both YYYY-MM-DD). */
const daysBetween = (a: string, b: string): number => {
	const t = (iso: string) => {
		const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
		return Date.UTC(y, m - 1, d);
	};
	return Math.round((t(b) - t(a)) / 86400000);
};

/**
 * The next open occurrence of a recurring task, as a full line to insert after the done line, or null when the
 * plugin cannot make one: no recurrence, no base date, or a rule the plugin cannot count. The new line keeps
 * the head (indent, list marker) and the recurrence rule and tags of the done line. The due (or scheduled) date
 * moves to the next date of the rule, counted from the done date ("today") when the rule says "when done".
 * The other start, scheduled and due dates move by the same number of days, like the Tasks plugin does.
 * The new line has no done date, no block id and no other status than open.
 */
export function nextOccurrenceLine(line: string, today: string, style: DateStyle): string | null {
	const t = splitTaskLine(line);
	if (!t) return null;
	const info = parseTaskLine(line);
	if (!info || !info.recurrence) return null;
	const field: DateField = info.dates.due ? 'due' : 'scheduled';
	const base = info.dates[field];
	if (!base) return null;
	const whenDone = /\bwhen[ \t]+done\b/i.test(info.recurrence) && /^\d{4}-\d{2}-\d{2}$/.test(today);
	const next = nextRecurrenceDate(info.recurrence, whenDone ? today : base);
	if (!next || next <= base) return null;
	const shift = daysBetween(base, next);
	let tail = t.tail;
	for (const f of ['start', 'scheduled', 'due'] as const) {
		const value = info.dates[f];
		if (value) tail = setDateInTail(tail, f, f === field ? next : addDays(value, shift), style);
	}
	// Drop the done date of the source line if the user ticked it in two steps (open with a done date already).
	tail = setDateInTail(tail, 'done', null, style);
	// A new occurrence is a new task: it gets no task id and no block id. A CRLF line keeps its "\r".
	const cr = tail.endsWith('\r') ? '\r' : '';
	tail = (cr ? tail.slice(0, -1) : tail).replace(ID_RE, '$1').replace(BLOCK_ID, '') + cr;
	return joinTaskLine({ head: t.head, status: ' ', tail });
}
