// Pure logic of Flatten Table: one row for each item of a list property (Dataview FLATTEN for Bases).
// No Obsidian import here, so vitest and the golden vectors run it directly.

export type FilterOp = 'contains' | 'not-contains' | 'equals' | 'not-equals' | 'gt' | 'lt' | 'gte' | 'lte' | 'empty' | 'not-empty';

export interface SourceNote {
	/** Vault path of the note. */
	path: string;
	/** Parsed front matter of the note (metadataCache), or null. */
	frontmatter: Record<string, unknown> | null | undefined;
}

export interface SortRule {
	column: string;
	dir: 'asc' | 'desc';
}

export type SortSpec = SortRule | SortRule[];

export interface FlattenOptions {
	/** The list property to flatten. A dotted path ("project.roles") reads a key inside an object. */
	property: string;
	/** Columns to show, in this order. Empty shows every key that the items have. */
	columns?: string[];
	/** A note without items gives one row with empty cells. */
	keepEmpty?: boolean;
	/** Sort rules in priority order. A single rule from an older base still works. */
	sort?: SortSpec | null;
	/** Pro: keep only rows that pass. */
	filter?: { column: string; op: FilterOp; value: string } | null;
	/** Pro: group the rows by the value of this column. */
	groupBy?: string;
	/** Largest number of notes that give rows (0 = no limit). The free version uses 50. */
	maxSources?: number;
}

export interface Row {
	source: string;
	/** Position of the item in the list, from 1. 0 for the empty row of a note without items. */
	index: number;
	cells: string[];
}

export interface Group {
	key: string;
	rows: Row[];
}

export interface Flat {
	/** Name of the column for a list of plain values (the last part of the property path). */
	valueColumn: string;
	columns: string[];
	rows: Row[];
	/** Notes that gave at least one row. */
	sources: number;
	/** Notes with rows that the note limit left out. */
	skippedSources: number;
	/** Notes in the base whose property is missing or empty. */
	emptyNotes: number;
	groups: Group[] | null;
}

export const SOURCE_COLUMN = 'Source';
export const INDEX_COLUMN = '#';
/** Nested objects deeper than this become JSON text in one cell. */
const MAX_DEPTH = 4;

/** Lower case, trimmed: the key used to match column names. */
export function normName(text: string): string {
	return text.trim().toLowerCase();
}

/** File name of a note without folder and extension. */
export function noteName(path: string): string {
	const base = path.slice(path.lastIndexOf('/') + 1);
	return base.replace(/\.md$/i, '');
}

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A key of an object, matched without regard to case when there is no exact key. */
function getKey(obj: Record<string, unknown>, key: string): unknown {
	if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
	const want = normName(key);
	const hit = Object.keys(obj).find((k) => normName(k) === want);
	return hit === undefined ? undefined : obj[hit];
}

/** Value of a property path. A key that holds dots is tried whole before the path is split. */
export function readPath(fm: Record<string, unknown> | null | undefined, path: string): unknown {
	if (!fm || !path.trim()) return undefined;
	const whole = getKey(fm, path.trim());
	if (whole !== undefined) return whole;
	let cur: unknown = fm;
	for (const part of path.split('.')) {
		if (!isObject(cur)) return undefined;
		cur = getKey(cur, part.trim());
		if (cur === undefined) return undefined;
	}
	return cur;
}

/** Text of a plain value. Lists of plain values are joined with ", ". */
export function scalarText(v: unknown): string {
	if (v === null || v === undefined) return '';
	if (typeof v === 'string') return v;
	if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
	if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
	if (Array.isArray(v)) return v.map((x) => (isObject(x) || Array.isArray(x) ? JSON.stringify(x) : scalarText(x))).join(', ');
	return JSON.stringify(v);
}

/** The cells of one object item as [column, text] pairs. Nested objects give "parent.child" columns. */
export function itemCells(item: Record<string, unknown>, prefix = '', depth = 0): [string, string][] {
	const out: [string, string][] = [];
	for (const [k, v] of Object.entries(item)) {
		const name = prefix ? `${prefix}.${k}` : k;
		if (isObject(v) && depth < MAX_DEPTH) out.push(...itemCells(v, name, depth + 1));
		else out.push([name, scalarText(v)]);
	}
	return out;
}

/** The items of a property value: a list gives its entries, one value gives one item, empty gives none. */
export function itemsOf(value: unknown): unknown[] {
	if (value === null || value === undefined || value === '') return [];
	if (Array.isArray(value)) return value.filter((x) => x !== null && x !== undefined && x !== '');
	return [value];
}

/** Last part of a property path, the column name for plain values. */
function valueColumnOf(property: string): string {
	const p = property.trim();
	const last = p.slice(p.lastIndexOf('.') + 1).trim();
	return last || 'Value';
}

interface RawRow {
	source: string;
	index: number;
	cells: Map<string, string>;
}

/** Rows of one note, keyed by normalized column name. Also records new column names in first-seen order. */
function noteRows(note: SourceNote, property: string, valueColumn: string, seen: Map<string, string>): RawRow[] {
	const items = itemsOf(readPath(note.frontmatter, property));
	return items.map((item, i) => {
		const pairs: [string, string][] = isObject(item) ? itemCells(item) : [[valueColumn, scalarText(item)]];
		const cells = new Map<string, string>();
		for (const [name, text] of pairs) {
			const key = normName(name);
			if (!seen.has(key)) seen.set(key, name);
			if (!cells.has(key)) cells.set(key, text);
		}
		return { source: note.path, index: i + 1, cells };
	});
}

/** The columns to show: the wanted names in their order, or every seen name. */
function pickColumns(seen: Map<string, string>, wanted: string[]): string[] {
	const list = wanted.map((c) => c.trim()).filter(Boolean);
	if (list.length === 0) return [...seen.values()];
	return list.map((c) => seen.get(normName(c)) ?? c);
}

/** Cell of a row by column name. Source and # work when no item key has that name. */
export function cellOf(row: Row, columns: string[], column: string): string | null {
	const want = normName(column);
	const k = columns.findIndex((c) => normName(c) === want);
	if (k >= 0) return row.cells[k]!;
	if (want === normName(SOURCE_COLUMN)) return noteName(row.source);
	if (want === INDEX_COLUMN) return row.index === 0 ? '' : String(row.index);
	return null;
}

/** A number from a cell: "1,200.50", "$12", "12 %" and "-3" count. Other text gives null. */
export function parseNumber(cell: string): number | null {
	let s = cell.replace(/[\s\u00a0]/g, '').replace(/\u2212/g, '-');
	if (!s) return null;
	s = s.replace(/^([+-]?)[$€£¥₹]/u, '$1').replace(/[$€£¥₹%]$/u, '');
	if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
	if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null;
	const n = Number(s);
	return Number.isFinite(n) ? n : null;
}

/** True when the row passes the filter. A filter on a missing column keeps no row. */
export function passes(row: Row, columns: string[], filter: NonNullable<FlattenOptions['filter']>): boolean {
	const cell = cellOf(row, columns, filter.column);
	if (cell === null) return false;
	const a = cell.trim().toLowerCase();
	const b = filter.value.trim().toLowerCase();
	switch (filter.op) {
		case 'empty':
			return a === '';
		case 'not-empty':
			return a !== '';
		case 'contains':
			return a.includes(b);
		case 'not-contains':
			return !a.includes(b);
		case 'equals':
			return a === b;
		case 'not-equals':
			return a !== b;
		default:
			return compareFilter(cell, filter.value, filter.op);
	}
}

/** gt, lt, gte, lte: numbers as numbers, ISO dates (YYYY-MM-DD) as text. Other values never pass. */
function compareFilter(cell: string, value: string, op: FilterOp): boolean {
	const x = parseNumber(cell);
	const y = parseNumber(value);
	let d: number;
	if (x !== null && y !== null) d = x - y;
	else if (ISO_DATE.test(cell.trim()) && ISO_DATE.test(value.trim())) d = cell.trim() < value.trim() ? -1 : cell.trim() > value.trim() ? 1 : 0;
	else return false;
	if (op === 'gt') return d > 0;
	if (op === 'lt') return d < 0;
	if (op === 'gte') return d >= 0;
	return d <= 0;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Compares two cells: numbers as numbers, other text (ISO dates too) in natural order. */
export function compareCells(a: string, b: string): number {
	const x = parseNumber(a);
	const y = parseNumber(b);
	if (x !== null && y !== null) return x - y;
	return collator.compare(a, b);
}

/** Reads old and new sort data. Drops invalid rules and repeated column names. */
export function readSort(value: unknown): SortRule[] {
	const rules: SortRule[] = [];
	const seen = new Set<string>();
	for (const entry of Array.isArray(value) ? value : [value]) {
		if (!isObject(entry) || typeof entry.column !== 'string' || (entry.dir !== 'asc' && entry.dir !== 'desc')) continue;
		const column = entry.column.trim();
		const key = normName(column);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		rules.push({ column, dir: entry.dir });
	}
	return rules;
}

/** Header click cycles a rule. Shift keeps the other rules and their priority. */
export function nextSort(value: unknown, column: string, extend: boolean): SortRule[] {
	const rules = readSort(value);
	const at = rules.findIndex((r) => normName(r.column) === normName(column));
	const active = rules[at];
	const next: SortRule | null = active?.dir === 'desc' ? null : { column, dir: active ? 'desc' : 'asc' };
	if (!extend) return next ? [next] : [];
	if (at < 0 && next) rules.push(next);
	else if (next) rules[at] = next;
	else if (at >= 0) rules.splice(at, 1);
	return rules;
}

/** Stable sort by rules in priority order. Empty cells stay last for each rule. */
export function sortRows(rows: Row[], columns: string[], sort: SortSpec): Row[] {
	const rules = readSort(sort);
	const keyed = rows.map((row, i) => ({ row, i, values: rules.map((r) => cellOf(row, columns, r.column) ?? '') }));
	keyed.sort((p, q) => {
		for (let k = 0; k < rules.length; k++) {
			const a = p.values[k]!;
			const b = q.values[k]!;
			const pe = a.trim() === '';
			const qe = b.trim() === '';
			if (pe !== qe) return pe ? 1 : -1;
			const diff = (rules[k]!.dir === 'desc' ? -1 : 1) * compareCells(a, b);
			if (diff) return diff;
		}
		return p.i - q.i;
	});
	return keyed.map((k) => k.row);
}

/** Groups in first-seen order (after the sort). An unknown column puts every row in one "" group. */
export function groupRows(rows: Row[], columns: string[], column: string): Group[] {
	const map = new Map<string, Group>();
	for (const row of rows) {
		const key = (cellOf(row, columns, column) ?? '').trim();
		const norm = key.toLowerCase();
		let g = map.get(norm);
		if (!g) {
			g = { key, rows: [] };
			map.set(norm, g);
		}
		g.rows.push(row);
	}
	return [...map.values()];
}

/** One row per list item over all notes, in base order, then filter, sort and group. */
export function flatten(notes: SourceNote[], options: FlattenOptions): Flat {
	const property = options.property.trim();
	const valueColumn = valueColumnOf(property);
	const seen = new Map<string, string>();
	const raw: RawRow[] = [];
	let sources = 0;
	let skippedSources = 0;
	let emptyNotes = 0;
	const max = options.maxSources ?? 0;
	for (const note of notes) {
		const rows = property ? noteRows(note, property, valueColumn, seen) : [];
		if (rows.length === 0) {
			emptyNotes++;
			if (options.keepEmpty && (max === 0 || sources < max)) raw.push({ source: note.path, index: 0, cells: new Map() });
			continue;
		}
		if (max > 0 && sources >= max) {
			skippedSources++;
			continue;
		}
		sources++;
		raw.push(...rows);
	}
	const columns = pickColumns(seen, options.columns ?? []);
	if (columns.length === 0 && raw.length > 0) columns.push(valueColumn);
	// Filter, sort and group see every key, also keys that the columns option hides.
	const all = [...columns, ...[...seen.values()].filter((c) => !columns.some((x) => normName(x) === normName(c)))];
	const keys = all.map(normName);
	let rows: Row[] = raw.map((r) => ({ source: r.source, index: r.index, cells: keys.map((k) => r.cells.get(k) ?? '') }));
	if (options.filter && options.filter.column.trim()) rows = rows.filter((r) => passes(r, all, options.filter!));
	if (options.sort) rows = sortRows(rows, all, options.sort);
	const groups = options.groupBy && options.groupBy.trim() ? groupRows(rows, all, options.groupBy) : null;
	// Cut the hidden cells in place, so group rows and rows stay the same objects.
	if (all.length > columns.length) for (const r of rows) r.cells.length = columns.length;
	return { valueColumn, columns, rows, sources, skippedSources, emptyNotes, groups };
}

/** Escapes a cell for a Markdown table: pipes become \| and line breaks become spaces. */
function mdCell(text: string): string {
	return text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

/** The flat table as a Markdown table. The Source column holds [[path|name]] links. */
export function toMarkdown(r: Flat, withSource = true): string {
	const head = withSource ? [SOURCE_COLUMN, ...r.columns] : [...r.columns];
	const line = (cells: string[]) => `| ${cells.map(mdCell).join(' | ')} |`;
	const out = [line(head), `| ${head.map(() => '---').join(' | ')} |`];
	for (const row of r.rows) out.push(line(withSource ? [`[[${row.source.replace(/\.md$/i, '')}|${noteName(row.source)}]]`, ...row.cells] : row.cells));
	return out.join('\n') + '\n';
}

/** One CSV field: quoted when it holds a comma, quote or line break (RFC 4180). */
function csvField(text: string): string {
	return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The flat table as CSV with a header row. The Source column holds the vault path. */
export function toCsv(r: Flat, withSource = true): string {
	const head = withSource ? [SOURCE_COLUMN, ...r.columns] : r.columns;
	const lines = [head.map(csvField).join(',')];
	for (const row of r.rows) lines.push((withSource ? [row.source, ...row.cells] : row.cells).map(csvField).join(','));
	return lines.join('\r\n') + '\r\n';
}
