// Pure logic for Visual Line Numbers. No Obsidian or CodeMirror import: the editor code measures, this module counts.
// A "unit" is what the editor draws for one block: one document line, or one folded section (a header line that hides lines).
// A "row" is one drawn display row of a unit. A line that wraps into 3 rows gives a unit with rows 3.

export type NumberMode = 'absolute' | 'relative' | 'hybrid' | 'dual';
export const MODES: readonly NumberMode[] = ['absolute', 'relative', 'hybrid', 'dual'];

export interface Unit {
	/** Document line number (1-based) of the first line in the unit. */
	line: number;
	/** Display rows drawn for the unit. At least 1. */
	rows: number;
	/** Document lines hidden in a fold after the first line. 0 for a plain line. */
	hidden: number;
}

export interface LabelOptions {
	mode: NumberMode;
	/** Pro. true: each hidden line of a fold takes one count. false: a fold counts as the rows it draws. */
	countFolded: boolean;
	/** Position of the cursor row, in rows from the start of the first unit. Negative when the cursor is above the first unit. */
	cursorRow: number;
	/** Document line number of the cursor line. Hybrid mode shows it on the cursor row. */
	cursorLine: number;
}

export interface RowLabel {
	/** Text for the gutter. Empty for a continuation row in absolute mode. */
	text: string;
	/** Signed distance in rows from the cursor row. Negative above the cursor, positive below. */
	distance: number;
}

const MAX_ROWS = 400;

/** Whole number at or above min. Anything else gives min. */
function atLeast(n: number, min: number): number {
	return Number.isFinite(n) ? Math.max(min, Math.floor(n)) : min;
}

/** How many counts a unit takes. */
export function weight(u: Unit, countFolded: boolean): number {
	return atLeast(u.rows, 1) + (countFolded ? atLeast(u.hidden, 0) : 0);
}

/** Row position (counted from the start of the first unit) at which each unit starts. */
export function unitStarts(units: readonly Unit[], countFolded: boolean): number[] {
	const out: number[] = [];
	let at = 0;
	for (const u of units) {
		out.push(at);
		at += weight(u, countFolded);
	}
	return out;
}

/** Sum of the weights of all units. */
export function totalWeight(units: readonly Unit[], countFolded: boolean): number {
	let sum = 0;
	for (const u of units) sum += weight(u, countFolded);
	return sum;
}

/** The text of one row for a signed distance from the cursor row. */
export function rowText(opts: LabelOptions, unit: Unit, rowInUnit: number, distance: number): string {
	if (opts.mode === 'absolute') return rowInUnit === 0 ? String(unit.line) : '';
	if (opts.mode === 'dual') return `${rowInUnit === 0 ? unit.line : ''} | ${Math.abs(distance)}`;
	if (opts.mode === 'hybrid' && distance === 0) return String(opts.cursorLine);
	return String(Math.abs(distance));
}

/** Labels for every row of every unit. One array of RowLabel for each unit, in the order of the units. */
export function labelUnits(units: readonly Unit[], opts: LabelOptions): RowLabel[][] {
	const starts = unitStarts(units, opts.countFolded);
	const out: RowLabel[][] = [];
	for (let i = 0; i < units.length; i++) {
		const u = units[i]!;
		const rows: RowLabel[] = [];
		for (let j = 0; j < atLeast(u.rows, 1); j++) {
			const distance = starts[i]! + j - opts.cursorRow;
			rows.push({ text: rowText(opts, u, j, distance), distance });
		}
		out.push(rows);
	}
	return out;
}

/**
 * Offsets of the first character of each display row of one document line.
 * nextRowEnd(pos) gives the offset where the display row that starts at pos ends. The editor supplies it
 * (EditorView.moveToLineBoundary); a test supplies a fake. The last row ends at lineEnd.
 * The loop stops after MAX_ROWS rows or when the end does not move forward.
 */
export function rowStarts(lineStart: number, lineEnd: number, nextRowEnd: (pos: number) => number, max: number = MAX_ROWS): number[] {
	const starts = [lineStart];
	let pos = lineStart;
	while (starts.length < max) {
		const end = nextRowEnd(pos);
		if (!(end > pos) || end >= lineEnd) break;
		starts.push(end);
		pos = end;
	}
	return starts;
}

/** Index of the cursor row. A negative association keeps a wrap boundary on the preceding row. */
export function rowIndexAt(starts: readonly number[], pos: number, assoc = 1): number {
	let idx = 0;
	for (let i = 0; i < starts.length; i++) {
		if (starts[i]! < pos || (starts[i] === pos && (i === 0 || assoc >= 0))) idx = i;
		else break;
	}
	return idx;
}

/** Row count from block height, for a block that the editor has not drawn yet. Not exact: heights of lines off screen are estimates. */
export function estimateRows(height: number, lineHeight: number): number {
	if (!(height > 0) || !(lineHeight > 0)) return 1;
	return Math.min(MAX_ROWS, Math.max(1, Math.round(height / lineHeight)));
}

/** Position of the cursor row when the cursor line is not drawn. heightGap is the pixel distance, rowHeight the default row height. */
export function offscreenCursorRow(heightGap: number, rowHeight: number): number {
	if (!Number.isFinite(heightGap) || !(rowHeight > 0)) return 0;
	return Math.round(heightGap / rowHeight);
}

/** Text for the hover hint of a row: the Vim display row motion that reaches it. Empty on the cursor row. */
export function motionHint(distance: number): string {
	if (distance === 0 || !Number.isFinite(distance)) return '';
	return `${Math.abs(distance)}${distance > 0 ? 'gj' : 'gk'}`;
}

/** Reads the per-note property. false, "false", "off", "no", "hide" and 0 turn the gutter off. Anything else gives null (use the global setting). */
export function parseNoteFlag(value: unknown): boolean | null {
	if (value === true || value === 1) return true;
	if (value === false || value === 0) return false;
	if (typeof value !== 'string') return null;
	const v = value.trim().toLowerCase();
	if (['true', 'on', 'yes', 'show'].includes(v)) return true;
	if (['false', 'off', 'no', 'hide'].includes(v)) return false;
	return null;
}

/** Width in digits for the gutter, so it does not change width while you scroll. */
export function gutterDigits(docLines: number): number {
	return Math.max(3, String(Math.max(1, Math.floor(docLines))).length);
}
