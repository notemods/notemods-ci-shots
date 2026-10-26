// Pure logic of Table Rollup: Markdown table and task parsing, header matching, merge, sort, filter, math, export.
// No obsidian import here, so every function runs in vitest and in the golden vectors.

export type Align = 'left' | 'right' | 'center' | null;

export interface ParsedTable {
	/** Heading texts above the table, outermost first (the heading stack at the table line). */
	headings: string[];
	/** Zero-based line of the header row in the note. */
	line: number;
	header: string[];
	align: Align[];
	rows: string[][];
}

export interface SourceNote {
	/** Vault path of the note. It is the id of the source in the result. */
	path: string;
	markdown: string;
	/** Tables already parsed from markdown (a cache). When present, markdown is not parsed again for tables. */
	tables?: ParsedTable[];
}

export type Mode = 'tables' | 'tasks';
export type Which = 'first' | 'second' | 'third' | 'all';
export type SummaryFn = 'none' | 'sum' | 'avg' | 'count' | 'min' | 'max';
export type FilterOp = 'contains' | 'not-contains' | 'equals' | 'not-equals' | 'gt' | 'lt' | 'gte' | 'lte' | 'empty' | 'not-empty';

export interface RollupOptions {
	mode?: Mode;
	/** Heading text. Empty means any table in the note. Leading # characters are ignored. */
	heading?: string;
	which?: Which;
	/** Columns to show, in this order, matched by name. Empty means every column of every table. */
	columns?: string[];
	sort?: { column: string; dir: 'asc' | 'desc' } | null;
	filter?: { column: string; op: FilterOp; value: string } | null;
	/** Text to find. Keeps only rows where a cell or the source note name holds this text, case insensitive. */
	find?: string;
	summary?: SummaryFn;
	/** Column name to group by. "Source" groups by note. */
	groupBy?: string;
	/** Largest number of notes that give rows. 0 or absent means no limit. */
	maxSources?: number;
}

export interface Row {
	source: string;
	cells: string[];
}

export interface Group {
	key: string;
	rows: Row[];
	summary: (string | null)[] | null;
}

export interface Rollup {
	columns: string[];
	align: Align[];
	rows: Row[];
	/** Notes that gave rows (after the limit). */
	sources: number;
	/** Notes with matching rows that the limit left out. */
	skippedSources: number;
	/** One formatted value per column (the source column is not included), or null when no summary is set. */
	summary: (string | null)[] | null;
	/** Rows grouped by the groupBy column with a summary per group, or null when no groupBy is set. */
	groups: Group[] | null;
}

export const SOURCE_COLUMN = 'Source';
const MAX_DECIMALS = 6;

// ---------------------------------------------------------------- row splitting

/** Length of the run of character ch that starts at i. */
function runLength(s: string, i: number, ch: string): number {
	let n = 0;
	while (s[i + n] === ch) n++;
	return n;
}

/** Index just past the code span that opens at i (a run of n backticks), or -1 if it never closes. */
function codeSpanEnd(s: string, i: number, n: number): number {
	let j = i + n;
	while (j < s.length) {
		const k = s.indexOf('`', j);
		if (k < 0) return -1;
		const m = runLength(s, k, '`');
		if (m === n) return k + m;
		j = k + m;
	}
	return -1;
}

/** Copies a code span and turns each escaped pipe inside it into a plain pipe (GFM does the same in tables). */
function copySpan(text: string): string {
	return text.replace(/\\\|/g, '|');
}

/**
 * Splits one table line into cells. Pipes inside `code spans` and [[wikilinks]] and escaped pipes (\|) do not split.
 * Returns null when the line has no splitting pipe, so it cannot be a table line.
 */
export function splitRow(line: string): string[] | null {
	const s = line.trim();
	const cells: string[] = [];
	let cur = '';
	let pipes = 0;
	let endsWithPipe = false;
	let i = 0;
	while (i < s.length) {
		const c = s[i]!;
		endsWithPipe = false;
		if (c === '\\' && s[i + 1] === '|') {
			cur += '|';
			i += 2;
		} else if (c === '`') {
			const n = runLength(s, i, '`');
			const end = codeSpanEnd(s, i, n);
			if (end < 0) {
				cur += s.slice(i, i + n);
				i += n;
			} else {
				cur += copySpan(s.slice(i, end));
				i = end;
			}
		} else if (c === '[' && s[i + 1] === '[' && s.indexOf(']]', i + 2) > 0) {
			const end = s.indexOf(']]', i + 2) + 2;
			cur += s.slice(i, end).replace(/\\\|/g, '|');
			i = end;
		} else if (c === '|') {
			cells.push(cur);
			cur = '';
			pipes++;
			endsWithPipe = true;
			i++;
		} else {
			cur += c;
			i++;
		}
	}
	if (pipes === 0) return null;
	if (!endsWithPipe) cells.push(cur);
	if (s.startsWith('|')) cells.shift();
	return cells.map((x) => x.trim());
}

/** Alignment of each cell of a delimiter row (| :-- | --: |), or null if the line is not a delimiter row. */
export function delimiterRow(cells: string[] | null): Align[] | null {
	if (!cells || cells.length === 0) return null;
	const out: Align[] = [];
	for (const c of cells) {
		if (!/^:?-+:?$/.test(c)) return null;
		const left = c.startsWith(':');
		const right = c.endsWith(':');
		out.push(left && right ? 'center' : right ? 'right' : left ? 'left' : null);
	}
	return out;
}

// ---------------------------------------------------------------- note scanning

/** Plain text of a heading or header cell: no #, emphasis, link brackets or extra spaces; lower case. */
export function normName(text: string): string {
	return text
		.replace(/^\s*#+\s*/, '')
		.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/[*_`~=]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

interface Line {
	text: string;
	quote: number;
}

/** Removes blockquote and callout markers ("> ") and returns the depth. */
function unquote(raw: string): Line {
	let text = raw;
	let quote = 0;
	for (let m = /^\s{0,3}>\s?/.exec(text); m && quote < 8; m = /^\s{0,3}>\s?/.exec(text)) {
		text = text.slice(m[0].length);
		quote++;
	}
	return { text, quote };
}

/** Index of the first line after YAML front matter. */
function bodyStart(lines: string[]): number {
	if (lines[0]?.trim() !== '---') return 0;
	for (let i = 1; i < lines.length; i++) if (/^(---|\.\.\.)\s*$/.test(lines[i]!)) return i + 1;
	return 0;
}

/** Calls visit(line, index, headings) for each line outside front matter and fenced code. Heading lines update the stack. */
function walk(markdown: string, visit: (line: Line, i: number, headings: string[], lines: string[]) => number | void): void {
	const lines = markdown.split(/\r?\n/);
	const stack: { level: number; text: string }[] = [];
	let fence: { ch: string; n: number } | null = null;
	for (let i = bodyStart(lines); i < lines.length; i++) {
		const ln = unquote(lines[i]!);
		const f = /^\s{0,3}(`{3,}|~{3,})/.exec(ln.text);
		if (fence) {
			if (f && f[1]![0] === fence.ch && f[1]!.length >= fence.n && ln.text.trim() === f[1]) fence = null;
			continue;
		}
		if (f) {
			fence = { ch: f[1]![0]!, n: f[1]!.length };
			continue;
		}
		const h = ln.quote === 0 ? /^ {0,3}(#{1,6})\s+(.*?)(\s+#+)?\s*$/.exec(ln.text) : null;
		if (h) {
			const level = h[1]!.length;
			while (stack.length && stack[stack.length - 1]!.level >= level) stack.pop();
			stack.push({ level, text: h[2]! });
			continue;
		}
		const skip = visit(ln, i, stack.map((x) => x.text), lines);
		if (typeof skip === 'number' && skip > i) i = skip;
	}
}

/** Every pipe table in a note, with the headings above it. Tables in code blocks and front matter are ignored. */
export function findTables(markdown: string): ParsedTable[] {
	const out: ParsedTable[] = [];
	walk(markdown, (ln, i, headings, lines) => {
		if (i + 1 >= lines.length) return;
		const header = splitRow(ln.text);
		if (!header) return;
		const next = unquote(lines[i + 1]!);
		const align = next.quote === ln.quote ? delimiterRow(splitRow(next.text)) : null;
		if (!align || align.length !== header.length) return;
		const rows: string[][] = [];
		let j = i + 2;
		for (; j < lines.length; j++) {
			const r = unquote(lines[j]!);
			if (r.quote !== ln.quote || !r.text.trim()) break;
			const cells = splitRow(r.text);
			if (!cells) break;
			rows.push(header.map((_, k) => cells[k] ?? ''));
		}
		out.push({ headings, line: i, header, align, rows });
		return j - 1;
	});
	return out;
}

/** True when the wanted heading is empty or is one of the headings above. */
function underHeading(headings: string[], wanted: string): boolean {
	return wanted === '' || headings.some((h) => normName(h) === wanted);
}

/** The tables to use from one note: under the heading, then the first, second, third or all of them. */
export function pickTables(tables: ParsedTable[], heading: string, which: Which): ParsedTable[] {
	const wanted = normName(heading);
	const hits = tables.filter((t) => underHeading(t.headings, wanted));
	if (which === 'all') return hits;
	const idx = { first: 0, second: 1, third: 2 }[which];
	const t = hits[idx];
	return t ? [t] : [];
}

/** Task list items under the heading as a table with the columns Task, Done and Due. */
export function findTasks(markdown: string, heading: string): ParsedTable {
	const wanted = normName(heading);
	const rows: string[][] = [];
	let first = -1;
	walk(markdown, (ln, i, headings) => {
		const m = /^\s*(?:[-*+]|\d+[.)])\s+\[(.)\]\s+(.*)$/.exec(ln.text);
		if (!m || !underHeading(headings, wanted)) return;
		if (first < 0) first = i;
		let text = m[2]!.replace(/\s+\^[\w-]+\s*$/, '');
		const due = /📅\s*(\d{4}-\d{2}-\d{2})/u.exec(text);
		if (due) text = text.replace(due[0], '').replace(/\s{2,}/g, ' ');
		rows.push([text.trim(), m[1] === ' ' ? 'no' : 'yes', due ? due[1]! : '']);
	});
	return { headings: [], line: first, header: ['Task', 'Done', 'Due'], align: [null, null, null], rows };
}

// ---------------------------------------------------------------- numbers

/** Number in a cell: 1,234.5  $12  12 %  -3  (4.50)  **7**. Null when the cell is not one number. */
export function parseNumber(cell: string): number | null {
	let s = cell.replace(/[*_`~=]/g, '').trim().replace(/\u2212/g, '-');
	if (!s) return null;
	let neg = false;
	const paren = /^\((.*)\)$/.exec(s);
	if (paren) {
		s = paren[1]!;
		neg = true;
	}
	const prefix = /^([+-]?)\p{Sc}\s*/u.exec(s);
	if (prefix) s = `${prefix[1]}${s.slice(prefix[0].length)}`;
	else s = s.replace(/[\p{Sc}%]$/u, '');
	s = s.trim();
	// Spaces can separate groups of three digits. Do not turn "1 2" into 12.
	if (/\s/u.test(s)) {
		if (!/^[+-]?\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:\.\d+)?$/.test(s)) return null;
		s = s.replace(/\s/gu, '');
	}
	if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
	if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null;
	const n = Number(s);
	if (!Number.isFinite(n)) return null;
	return neg ? -n : n;
}

/** Digits after the decimal point in a number cell (0 for an integer). */
function decimals(cell: string): number {
	const m = /(\d*\.?\d+)(?:[eE]([+-]?\d+))?/.exec(cell.replace(/[,\s]/gu, ''));
	if (!m) return 0;
	const fraction = m[1]!.split('.')[1]?.length ?? 0;
	return Math.min(MAX_DECIMALS, Math.max(0, fraction - Number(m[2] ?? 0)));
}

/** Formats a number with at most `places` decimals and no trailing zeros. */
export function formatNumber(n: number, places: number): string {
	const p = Math.max(0, Math.min(MAX_DECIMALS, places));
	const fixed = n.toFixed(p);
	const out = p > 0 ? fixed.replace(/\.?0+$/, '') : fixed;
	return out === '-0' ? '0' : out;
}

/**
 * Summary of one column. count = non-empty cells of any kind. sum, avg, min and max need a number column:
 * at least one number and no other non-empty cell. Otherwise null.
 */
export function summarize(cells: string[], fn: SummaryFn): string | null {
	if (fn === 'none') return null;
	const filled = cells.filter((c) => c.trim() !== '');
	if (fn === 'count') return String(filled.length);
	const nums = filled.map(parseNumber);
	if (nums.length === 0 || nums.some((n) => n === null)) return null;
	const values = nums as number[];
	// reduce, not Math.max(...list): a spread of 100,000 or more values overflows the call stack.
	const places = filled.reduce((a, c) => Math.max(a, decimals(c)), 0);
	const sum = values.reduce((a, b) => a + b, 0);
	if (fn === 'sum') return formatNumber(sum, places);
	if (fn === 'avg') return formatNumber(sum / values.length, places + 2);
	return formatNumber(values.reduce((a, b) => (fn === 'min' ? Math.min(a, b) : Math.max(a, b))), places);
}

// ---------------------------------------------------------------- merge, filter, sort, group

/** Columns of the merged table: the wanted list, or the union of the header names in first-seen order. */
export function mergeColumns(headers: string[][], wanted: string[]): string[] {
	const want = wanted.map((w) => w.trim()).filter(Boolean);
	if (want.length) return want;
	const seen = new Map<string, string>();
	for (const h of headers) for (const name of uniqueHeader(h)) if (!seen.has(normName(name))) seen.set(normName(name), name);
	return [...seen.values()];
}

/** Header names with a number added to repeated names: Amount, Amount (2). Empty names become Column N. */
export function uniqueHeader(header: string[]): string[] {
	const reserved = new Set(header.filter((h) => h.trim()).map(normName));
	const used = new Set<string>();
	return header.map((raw, i) => {
		const base = raw.trim() || `Column ${i + 1}`;
		let name = base;
		let n = 2;
		while (used.has(normName(name)) || (!raw.trim() && reserved.has(normName(name))) || (name !== base && reserved.has(normName(name)))) name = `${base} (${n++})`;
		used.add(normName(name));
		return name;
	});
}

/** Maps the rows of one table onto the merged columns by header name (case and emphasis do not matter). */
export function mapRows(table: { header: string[]; rows: string[][] }, columns: string[], source: string): Row[] {
	const names = uniqueHeader(table.header).map(normName);
	const idx = columns.map((c) => names.indexOf(normName(c)));
	return table.rows.map((r) => ({ source, cells: idx.map((k) => (k < 0 ? '' : (r[k] ?? ''))) }));
}

/** Basename of a vault path without the .md extension. */
export function noteName(path: string): string {
	const base = path.slice(path.lastIndexOf('/') + 1);
	return base.replace(/\.md$/i, '');
}

/** Cell value of a row by column name, where "Source" is the note name. */
function cellOf(row: Row, columns: string[], column: string): string | null {
	if (normName(column) === normName(SOURCE_COLUMN) && !columns.some((c) => normName(c) === normName(SOURCE_COLUMN))) return noteName(row.source);
	const k = columns.findIndex((c) => normName(c) === normName(column));
	return k < 0 ? null : row.cells[k]!;
}

/** True when the row passes the filter. A filter on a missing column keeps no row. */
export function passes(row: Row, columns: string[], filter: NonNullable<RollupOptions['filter']>): boolean {
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
		default: {
			const x = parseNumber(cell);
			const y = parseNumber(filter.value);
			if (x === null || y === null) return false;
			if (filter.op === 'gt') return x > y;
			if (filter.op === 'lt') return x < y;
			if (filter.op === 'gte') return x >= y;
			return x <= y;
		}
	}
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Compares two cells: numbers as numbers, other text in natural order. Empty cells sort last in both directions. */
export function compareCells(a: string, b: string): number {
	const x = parseNumber(a);
	const y = parseNumber(b);
	if (x !== null && y !== null) return x - y;
	return collator.compare(a, b);
}

/** Stable sort of rows by one column. Empty cells stay at the end. */
export function sortRows(rows: Row[], columns: string[], sort: NonNullable<RollupOptions['sort']>): Row[] {
	const sign = sort.dir === 'desc' ? -1 : 1;
	const keyed = rows.map((row, i) => ({ row, i, v: cellOf(row, columns, sort.column) ?? '' }));
	keyed.sort((p, q) => {
		const pe = p.v.trim() === '';
		const qe = q.v.trim() === '';
		if (pe !== qe) return pe ? 1 : -1;
		return sign * compareCells(p.v, q.v) || p.i - q.i;
	});
	return keyed.map((k) => k.row);
}

/** Summary row for a set of rows: one value per column. */
export function summaryRow(rows: Row[], columns: string[], fn: SummaryFn): (string | null)[] | null {
	if (fn === 'none') return null;
	return columns.map((_, k) => summarize(rows.map((r) => r.cells[k]!), fn));
}

/** Groups rows by the value of one column, in order of first appearance. */
export function groupRows(rows: Row[], columns: string[], column: string, fn: SummaryFn): Group[] {
	const map = new Map<string, Row[]>();
	for (const r of rows) {
		const key = (cellOf(r, columns, column) ?? '').trim();
		const list = map.get(key);
		if (list) list.push(r);
		else map.set(key, [r]);
	}
	return [...map.entries()].map(([key, list]) => ({ key, rows: list, summary: summaryRow(list, columns, fn) }));
}

// ---------------------------------------------------------------- the whole pipeline

/** Rows of one note for the chosen mode. */
function noteRows(note: SourceNote, opts: Required<Pick<RollupOptions, 'mode' | 'heading' | 'which'>>): { header: string[]; align: Align[]; rows: string[][] }[] {
	if (opts.mode === 'tasks') {
		const t = findTasks(note.markdown, opts.heading);
		return t.rows.length ? [t] : [];
	}
	return pickTables(note.tables ?? findTables(note.markdown), opts.heading, opts.which).filter((t) => t.rows.length > 0);
}

/**
 * Builds the merged table from the notes in the given order. Steps: pick tables, apply the note limit, merge
 * columns by name, filter, sort, summary, groups.
 */
export function rollup(notes: SourceNote[], options: RollupOptions = {}): Rollup {
	const opts = { mode: options.mode ?? 'tables', heading: options.heading ?? '', which: options.which ?? 'first' } as const;
	const limit = options.maxSources && options.maxSources > 0 ? options.maxSources : Infinity;
	const picked: { path: string; tables: ReturnType<typeof noteRows> }[] = [];
	let skipped = 0;
	for (const n of notes) {
		const tables = noteRows(n, opts);
		if (!tables.length) continue;
		if (picked.length >= limit) skipped++;
		else picked.push({ path: n.path, tables });
	}
	const all = picked.flatMap((p) => p.tables);
	const columns = mergeColumns(
		all.map((t) => t.header),
		options.columns ?? [],
	);
	const align = columns.map((c) => {
		for (const t of all) {
			const k = uniqueHeader(t.header).findIndex((h) => normName(h) === normName(c));
			if (k >= 0 && t.align[k]) return t.align[k];
		}
		return null;
	});
	let rows = picked.flatMap((p) => p.tables.flatMap((t) => mapRows(t, columns, p.path)));
	if (options.find?.trim()) {
		const needle = options.find.trim().toLowerCase();
		rows = rows.filter((r) => r.cells.some((c) => c.toLowerCase().includes(needle)) || noteName(r.source).toLowerCase().includes(needle));
	}
	if (options.filter && options.filter.column.trim()) rows = rows.filter((r) => passes(r, columns, options.filter!));
	if (options.sort && options.sort.column) rows = sortRows(rows, columns, options.sort);
	const fn = options.summary ?? 'none';
	const groupBy = options.groupBy?.trim() ?? '';
	return {
		columns,
		align,
		rows,
		sources: picked.length,
		skippedSources: skipped,
		summary: summaryRow(rows, columns, fn),
		groups: groupBy ? groupRows(rows, columns, groupBy, fn) : null,
	};
}

// ---------------------------------------------------------------- export

/** Escapes a cell for a Markdown table: pipes become \| and line breaks become spaces. */
function mdCell(text: string): string {
	return text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

/** The merged table as a Markdown table. The Source column holds [[path|name]] links; a summary row is added last. */
export function toMarkdown(r: Rollup, withSource = true): string {
	const head = withSource ? [SOURCE_COLUMN, ...r.columns] : [...r.columns];
	const al = (withSource ? [null, ...r.align] : r.align).map((a) => (a === 'right' ? '--:' : a === 'center' ? ':-:' : a === 'left' ? ':--' : '---'));
	const line = (cells: string[]) => `| ${cells.map(mdCell).join(' | ')} |`;
	const out = [line(head), `| ${al.join(' | ')} |`];
	for (const row of r.rows) out.push(line(withSource ? [`[[${row.source.replace(/\.md$/i, '')}|${noteName(row.source)}]]`, ...row.cells] : row.cells));
	if (r.summary) out.push(line(withSource ? ['**Summary**', ...r.summary.map((s) => s ?? '')] : r.summary.map((s) => s ?? '')));
	return out.join('\n') + '\n';
}

/** One CSV field: quoted when it holds a comma, quote or line break (RFC 4180). */
function csvField(text: string): string {
	return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The merged table as CSV with a header row. The Source column holds the vault path. No summary row. */
export function toCsv(r: Rollup, withSource = true): string {
	const head = withSource ? [SOURCE_COLUMN, ...r.columns] : r.columns;
	const lines = [head.map(csvField).join(',')];
	for (const row of r.rows) lines.push((withSource ? [row.source, ...row.cells] : row.cells).map(csvField).join(','));
	return lines.join('\r\n') + '\r\n';
}
