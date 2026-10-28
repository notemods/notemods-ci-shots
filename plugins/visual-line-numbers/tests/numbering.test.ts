import { describe, expect, it } from 'vitest';
import {
	estimateRows,
	gutterDigits,
	labelUnits,
	motionHint,
	offscreenCursorRow,
	parseNoteFlag,
	rowIndexAt,
	rowStarts,
	totalWeight,
	unitStarts,
	weight,
	type Unit,
} from '../src/numbering';

/** A fake editor: rows of `width` characters, as a monospace editor wraps a line. */
const wrapAt = (width: number, lineStart: number) => (pos: number) => lineStart + (Math.floor((pos - lineStart) / width) + 1) * width;

describe('rowStarts', () => {
	it('gives one row for a short line', () => {
		expect(rowStarts(10, 30, wrapAt(80, 10))).toEqual([10]);
	});
	it('gives a start for each wrapped row', () => {
		expect(rowStarts(0, 250, wrapAt(80, 0))).toEqual([0, 80, 160, 240]);
	});
	it('does not count an empty last row when the line ends on a wrap point', () => {
		expect(rowStarts(0, 160, wrapAt(80, 0))).toEqual([0, 80]);
	});
	it('stops when the end does not move forward', () => {
		expect(rowStarts(5, 100, () => 5)).toEqual([5]);
		expect(rowStarts(5, 100, () => Number.NaN)).toEqual([5]);
	});
	it('stops at the row limit', () => {
		expect(rowStarts(0, 1_000_000, (p) => p + 1, 50)).toHaveLength(50);
	});
});

describe('rowIndexAt', () => {
	it('keeps a cursor at the end of a wrapped row on that row', () => {
		expect(rowIndexAt([0, 80, 160], 80, -1)).toBe(0);
		expect(rowIndexAt([0, 80, 160], 80, 1)).toBe(1);
		expect(rowIndexAt([0, 80, 160], 160, -1)).toBe(1);
		expect(rowIndexAt([0, 80, 160], 0, -1)).toBe(0);
	});
	it('finds the row that holds an offset', () => {
		const starts = [0, 80, 160];
		expect(rowIndexAt(starts, 0)).toBe(0);
		expect(rowIndexAt(starts, 79)).toBe(0);
		expect(rowIndexAt(starts, 80)).toBe(1);
		expect(rowIndexAt(starts, 500)).toBe(2);
		expect(rowIndexAt(starts, -1)).toBe(0);
	});
});

describe('weights', () => {
	const units: Unit[] = [
		{ line: 1, rows: 2, hidden: 0 },
		{ line: 3, rows: 1, hidden: 4 },
	];
	it('counts rows, and hidden lines only when asked', () => {
		expect(weight(units[1]!, false)).toBe(1);
		expect(weight(units[1]!, true)).toBe(5);
		expect(unitStarts(units, false)).toEqual([0, 2]);
		expect(unitStarts(units, true)).toEqual([0, 2]);
		expect(totalWeight(units, false)).toBe(3);
		expect(totalWeight(units, true)).toBe(7);
	});
	it('treats bad numbers as safe values', () => {
		expect(weight({ line: 1, rows: Number.NaN, hidden: Number.POSITIVE_INFINITY }, true)).toBe(1);
		expect(weight({ line: 1, rows: 2.9, hidden: 1.5 }, true)).toBe(3);
	});
});

describe('labelUnits distances', () => {
	it('gives a signed distance: negative above the cursor, positive below', () => {
		const out = labelUnits([{ line: 1, rows: 1, hidden: 0 }, { line: 2, rows: 3, hidden: 0 }], { mode: 'relative', countFolded: false, cursorRow: 1, cursorLine: 2 });
		expect(out.flat().map((r) => r.distance)).toEqual([-1, 0, 1, 2]);
	});
	it('keeps the same count above and below for every cursor row', () => {
		const units: Unit[] = Array.from({ length: 9 }, (_, i) => ({ line: i + 1, rows: (i % 3) + 1, hidden: 0 }));
		const total = totalWeight(units, false);
		for (let c = 0; c < total; c++) {
			const texts = labelUnits(units, { mode: 'relative', countFolded: false, cursorRow: c, cursorLine: 1 }).flat().map((r) => Number(r.text));
			expect(texts[c]).toBe(0);
			expect(texts.filter((t) => t === 0)).toHaveLength(1);
			for (let k = 1; c - k >= 0 && c + k < total; k++) expect(texts[c - k]).toBe(texts[c + k]);
		}
	});
	it('dual mode keeps relative distances while document numbers stay fixed', () => {
		const units: Unit[] = [{ line: 98, rows: 3, hidden: 0 }, { line: 99, rows: 2, hidden: 0 }, { line: 100, rows: 1, hidden: 0 }];
		for (let cursorRow = 0; cursorRow < totalWeight(units, false); cursorRow++) {
			const options = { countFolded: false, cursorRow, cursorLine: 99 };
			const dual = labelUnits(units, { ...options, mode: 'dual' });
			const relative = labelUnits(units, { ...options, mode: 'relative' });
			expect(dual.map((rows) => rows.map((r) => r.text.split(' | ')[1]))).toEqual(relative.map((rows) => rows.map((r) => r.text)));
			expect(dual.map((rows) => rows[0]!.text.split(' | ')[0])).toEqual(['98', '99', '100']);
			expect(dual.flat().map((r) => r.distance)).toEqual(relative.flat().map((r) => r.distance));
		}
	});
});

describe('helpers', () => {
	it('estimates rows from a height', () => {
		expect(estimateRows(72, 24)).toBe(3);
		expect(estimateRows(10, 24)).toBe(1);
		expect(estimateRows(0, 24)).toBe(1);
		expect(estimateRows(100, 0)).toBe(1);
		expect(estimateRows(1e9, 1)).toBe(400);
	});
	it('rounds the cursor distance of an off screen line', () => {
		expect(offscreenCursorRow(-240, 24)).toBe(-10);
		expect(offscreenCursorRow(250, 24)).toBe(10);
		expect(offscreenCursorRow(5, 0)).toBe(0);
		expect(offscreenCursorRow(Number.NaN, 24)).toBe(0);
	});
	it('names the Vim motion for a row', () => {
		expect(motionHint(5)).toBe('5gj');
		expect(motionHint(-3)).toBe('3gk');
		expect(motionHint(0)).toBe('');
	});
	it('reads the note property', () => {
		for (const v of [false, 0, 'false', ' Off ', 'NO', 'hide']) expect(parseNoteFlag(v)).toBe(false);
		for (const v of [true, 1, 'true', 'on', 'yes', 'show']) expect(parseNoteFlag(v)).toBe(true);
		for (const v of [undefined, null, '', 'maybe', 7, [], {}]) expect(parseNoteFlag(v)).toBeNull();
	});
	it('sizes the gutter from the line count', () => {
		expect(gutterDigits(5)).toBe(3);
		expect(gutterDigits(999)).toBe(3);
		expect(gutterDigits(12345)).toBe(5);
		expect(gutterDigits(0)).toBe(3);
	});
});
