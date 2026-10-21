import { describe, expect, it } from 'vitest';
import vectors from './vectors/bases-freeze-panes.json';
import { clampColumns, planRow } from '../src/layout';

describe('golden vectors (packages/spec/vectors/bases-freeze-panes.json)', () => {
	for (const c of vectors.cases) {
		it(c.name, () => {
			const [widths, frozen, left, right, pinLast] = c.args as [number[], number, number, number, boolean?];
			expect(planRow(widths, frozen, left, right, pinLast)).toEqual(c.expected);
		});
	}
});

describe('planRow', () => {
	it('puts frozen cells first and keeps column order', () => {
		const plan = planRow([50, 60, 70, 80], 2, 120, 200);
		expect(plan?.cells.map((c) => c.index)).toEqual([0, 1, 2, 3]);
		expect(plan?.cells.filter((c) => c.frozen).map((c) => c.start)).toEqual([0, 50]);
	});

	it('gives each frozen cell the sum of the widths before it as its start offset', () => {
		const plan = planRow([120.5, 80, 300], 3, 1000, 1200);
		expect(plan?.cells.map((c) => c.start)).toEqual([0, 120.5, 200.5]);
	});

	it('returns null for widths that are not finite numbers', () => {
		expect(planRow([100, Number.NaN], 1, 0, 10)).toBeNull();
		expect(planRow([100], 1, Number.NaN, 10)).toBeNull();
	});
});

describe('clampColumns', () => {
	it('accepts numbers and numeric strings and clamps them to 0..3', () => {
		expect(clampColumns(2, 1)).toBe(2);
		expect(clampColumns('3', 1)).toBe(3);
		expect(clampColumns(-4, 1)).toBe(0);
		expect(clampColumns(9, 1)).toBe(3);
	});

	it('falls back for values that are not numbers', () => {
		expect(clampColumns('many', 1)).toBe(1);
		expect(clampColumns(null, 0)).toBe(0);
		expect(clampColumns('', 2)).toBe(2);
	});
});

describe('pin a visible property', () => {
	it('keeps a middle column next to the leading frozen columns', () => {
		const plan = planRow([100, 80, 60, 90, 50], 1, 280, 350, false, 3);
		expect(plan?.frozen).toBe(2);
		expect(plan?.cells.filter((c) => c.frozen)).toEqual([
			{ index: 0, start: 0, width: 100, frozen: true },
			{ index: 3, start: 100, width: 90, frozen: true },
		]);
		expect(plan?.cells.map((c) => c.index)).toContain(4);
	});
	it('can pin one property with no leading columns and does not pin it twice at the end', () => {
		const plan = planRow([100, 80, 60, 90], 0, 0, 10, true, 3);
		expect(plan?.end).toBeNull();
		expect(plan?.cells.find((c) => c.index === 3)).toEqual({ index: 3, start: 0, width: 90, frozen: true });
	});
	it('ignores a missing, invalid or already frozen property index', () => {
		for (const index of [-1, 0, 1.5, 20]) {
			expect(planRow([100, 80, 60], 1, 110, 160, false, index)).toEqual(planRow([100, 80, 60], 1, 110, 160));
		}
	});
});

describe('property pin keeps intervening columns reachable', () => {
	it('moves the intervening cells out from under the property without adding width', () => {
		const plan = planRow([100, 80, 60, 90, 50], 1, 0, 500, false, 3)!;
		const physical = [...plan.cells].sort((a, b) => a.start - b.start);
		expect(physical.map((c) => c.index)).toEqual([0, 3, 1, 2, 4]);
		for (let i = 1; i < physical.length; i++) expect(physical[i]!.start).toBe(physical[i - 1]!.start + physical[i - 1]!.width);
		expect(physical[physical.length - 1]!.start + physical[physical.length - 1]!.width).toBe(380);
	});
	it('virtualizes the moved cells by their displayed position', () => {
		const plan = planRow([100, 80, 60, 90, 50], 1, 200, 250, false, 3)!;
		expect(plan.cells.map((c) => c.index)).toEqual([0, 1, 3]);
		expect(plan.cells.find((c) => c.index === 1)?.start).toBe(190);
	});
});
