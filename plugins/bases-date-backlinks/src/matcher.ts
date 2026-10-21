import { getObsidianMoment, type MomentLike } from './obsidian-moment';

const moment = getObsidianMoment();

export type RollupPeriod = 'day' | 'week' | 'month';

export interface DateWindow {
	start: string;
	end: string;
}

export interface DateRow {
	id: string;
	values: Record<string, unknown>;
}

export interface MatchOptions {
	target: unknown;
	dateFormat?: string;
	period?: RollupPeriod;
	weekStart?: 'iso' | 'locale';
	dateProperties?: readonly string[];
	rangeStart?: string | null;
	rangeEnd?: string | null;
}

type MomentValue = MomentLike;

function valueText(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (value instanceof Date) return moment(value).format('YYYY-MM-DD');
	if (typeof value === 'string') return value.trim() || null;
	if (typeof value === 'number' && Number.isFinite(value)) return String(value);
	if (typeof value === 'object' && 'toString' in value && typeof value.toString === 'function') {
		const stringValue = value as { toString(): string };
		const text = stringValue.toString().trim();
		return text && text !== '[object Object]' ? text : null;
	}
	return null;
}

function valueItems(value: unknown): unknown[] {
	if (Array.isArray(value)) return value;
	if (value && typeof value === 'object') {
		const list = value as { length?: unknown; get?: unknown };
		if (typeof list.length === 'function' && typeof list.get === 'function') {
			const items: unknown[] = [];
			for (let i = 0; i < (list.length as () => number)(); i++) items.push((list.get as (index: number) => unknown)(i));
			return items;
		}
	}
	return [value];
}

function parseDate(value: unknown, format?: string): MomentValue | null {
	const raw = valueText(value)?.replace(/\.(?:md|markdown)$/i, '');
	if (!raw) return null;
	if (value instanceof Date) {
		const parsed = moment(value);
		return parsed.isValid() ? parsed : null;
	}
	if (format) {
		const formatted = moment(raw, format, true);
		if (formatted.isValid()) return formatted;
	}
	const iso = moment(raw, moment.ISO_8601, true);
	return iso.isValid() ? iso : null;
}

/** Builds an inclusive local-calendar date window from a daily, weekly, or monthly note date. */
export function dateWindow(target: unknown, dateFormat = 'YYYY-MM-DD', period: RollupPeriod = 'day', weekStart: 'iso' | 'locale' = 'iso'): DateWindow | null {
	const parsed = parseDate(target, dateFormat);
	if (!parsed) return null;
	const safePeriod: RollupPeriod = period === 'week' || period === 'month' ? period : 'day';
	const start = parsed.clone();
	const end = parsed.clone();
	if (safePeriod === 'week') {
		const unit = weekStart === 'locale' ? 'week' : 'isoWeek';
		start.startOf(unit);
		end.endOf(unit);
	} else if (safePeriod === 'month') {
		start.startOf('month');
		end.endOf('month');
	} else {
		start.startOf('day');
		end.endOf('day');
	}
	return { start: start.format('YYYY-MM-DD'), end: end.format('YYYY-MM-DD') };
}

function dateKeys(value: unknown): string[] {
	return valueItems(value)
		.map((item) => parseDate(item)?.format('YYYY-MM-DD') ?? null)
		.filter((day): day is string => day !== null);
}

function valueMatchesWindow(value: unknown, window: DateWindow): boolean {
	return dateKeys(value).some((day) => day >= window.start && day <= window.end);
}

function rangeMatchesWindow(startValue: unknown, endValue: unknown, window: DateWindow): boolean {
	const starts = dateKeys(startValue);
	const ends = dateKeys(endValue);
	return starts.some((start) => ends.some((end) => start <= end && start <= window.end && end >= window.start));
}

export interface RowMatch { id: string; properties: string[]; range: boolean }

/** Includes only the properties that actually match, plus the range flag. */
export function matchDetails(rows: readonly DateRow[], options: MatchOptions): RowMatch[] {
	const window = dateWindow(options.target, options.dateFormat, options.period, options.weekStart);
	if (!window) return [];
	const properties = [...new Set((options.dateProperties ?? []).map((name) => name.trim()).filter(Boolean))];
	return rows.flatMap((row) => {
		const matched = properties.filter((property) => valueMatchesWindow(row.values[property], window));
		const range = !!options.rangeStart && !!options.rangeEnd && rangeMatchesWindow(row.values[options.rangeStart], row.values[options.rangeEnd], window);
		return matched.length || range ? [{ id: row.id, properties: matched, range }] : [];
	});
}

/** Returns the ids of matching rows for callers that do not need labels. */
export function matchRows(rows: readonly DateRow[], options: MatchOptions): string[] {
	return matchDetails(rows, options).map((row) => row.id);
}
