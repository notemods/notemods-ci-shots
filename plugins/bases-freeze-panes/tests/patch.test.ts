import { describe, expect, it } from 'vitest';
import { END_CLASS, FROZEN_CLASS, LAST_CLASS, installColumnPatch } from '../src/patch';

// A stand-in for the core table: one shared row prototype with the same virtualize contract
// (keep the cells whose column overlaps [left, right], set their offset and width, drop the rest).
class Row {
	cells: { el: HTMLElement }[];
	el: HTMLElement;
	constructor(count: number) {
		this.el = createDiv('bases-tr');
		this.cells = Array.from({ length: count }, () => ({ el: createDiv('bases-td') }));
	}
}
interface CoreRow {
	cells: { el: HTMLElement }[];
	el: HTMLElement;
}
function coreVirtualize(this: CoreRow, widths: number[], left: number, right: number): void {
	let start = 0;
	const keep: HTMLElement[] = [];
	this.cells.forEach((cell, i) => {
		const end = start + (widths[i] ?? 0);
		if (end >= left && start <= right) {
			cell.el.setCssStyles({ insetInlineStart: `${start}px` });
			keep.push(cell.el);
		}
		start = end;
	});
	this.el.setChildrenInPlace(keep);
}
Object.defineProperty(Row.prototype, 'virtualize', { value: coreVirtualize, writable: true, configurable: true });

function fakeApp() {
	const header = new Row(3);
	const workspace = { getLeavesOfType: () => [{ view: { controller: { view: { header } } } }] };
	return {
		app: { workspace },
		row: () => new Row(4) as Row & { virtualize: typeof coreVirtualize },
	};
}

const widths = [100, 100, 100, 100];

describe('installColumnPatch', () => {
	it('keeps frozen cells in the row after the table scrolls past them', () => {
		const { app, row } = fakeApp();
		const patch = installColumnPatch(app as never, () => 1);
		expect(patch).not.toBeNull();
		const r = row();
		r.virtualize(widths, 250, 400);
		expect(Array.from(r.el.children)).toEqual([r.cells[0]!.el, r.cells[2]!.el, r.cells[3]!.el]);
		expect(r.cells[0]!.el.hasClass(FROZEN_CLASS)).toBe(true);
		expect(r.cells[0]!.el.hasClass(LAST_CLASS)).toBe(true);
		patch?.remove();
	});

	it('restores the core method on remove', () => {
		const { app, row } = fakeApp();
		installColumnPatch(app as never, () => 2)?.remove();
		const r = row();
		r.virtualize(widths, 250, 400);
		expect(Array.from(r.el.children)).toEqual([r.cells[2]!.el, r.cells[3]!.el]);
		expect(Row.prototype).toHaveProperty('virtualize', coreVirtualize);
	});

	it('leaves rows to the core method and clears old marks when the count is 0', () => {
		const { app, row } = fakeApp();
		let count = 1;
		const patch = installColumnPatch(app as never, () => count);
		const r = row();
		r.virtualize(widths, 250, 400);
		count = 0;
		r.virtualize(widths, 250, 400);
		expect(Array.from(r.el.children)).toEqual([r.cells[2]!.el, r.cells[3]!.el]);
		expect(r.cells[0]!.el.hasClass(FROZEN_CLASS)).toBe(false);
		patch?.remove();
	});

	it('pins the last column: kept after the frozen cells with a start margin back to its own offset', () => {
		const { app, row } = fakeApp();
		let pin = true;
		const patch = installColumnPatch(app as never, () => 1, () => pin);
		const r = row();
		r.virtualize(widths, 120, 180);
		expect(Array.from(r.el.children)).toEqual([r.cells[0]!.el, r.cells[1]!.el, r.cells[3]!.el]);
		expect(r.cells[3]!.el.hasClass(END_CLASS)).toBe(true);
		expect(r.cells[3]!.el.style.marginInlineStart).toBe('200px');
		pin = false;
		r.virtualize(widths, 120, 180);
		expect(Array.from(r.el.children)).toEqual([r.cells[0]!.el, r.cells[1]!.el]);
		expect(r.cells[3]!.el.hasClass(END_CLASS)).toBe(false);
		expect(r.cells[3]!.el.style.marginInlineStart).toBe('');
		patch?.remove();
	});

	it('pins the last column with 0 frozen columns', () => {
		const { app, row } = fakeApp();
		const patch = installColumnPatch(app as never, () => 0, () => true);
		const r = row();
		r.virtualize(widths, 0, 50);
		expect(Array.from(r.el.children)).toEqual([r.cells[0]!.el, r.cells[3]!.el]);
		expect(r.cells[3]!.el.style.marginInlineStart).toBe('300px');
		patch?.remove();
	});

	it('a detached table view built to find the row class is unloaded at once; remove leaves no patched method', () => {
		const header = new Row(3);
		let unloads = 0;
		const factory = () => ({ header, unload: () => unloads++ });
		const workspace = { getLeavesOfType: () => [] };
		const internalPlugins = { getPluginById: () => ({ instance: { registrations: { table: { factory } } } }) };
		const app = { workspace, internalPlugins };
		const patch = installColumnPatch(app as never, () => 1);
		expect(patch).not.toBeNull();
		expect(unloads).toBe(1);
		expect(Row.prototype).not.toHaveProperty('virtualize', coreVirtualize);
		patch?.remove();
		expect(Row.prototype).toHaveProperty('virtualize', coreVirtualize);
		expect(unloads).toBe(1);
	});

	it('the pinned last cell drops its start offset so sticky end works', () => {
		const { app, row } = fakeApp();
		const patch = installColumnPatch(app as never, () => 1, () => true);
		const r = row();
		r.virtualize(widths, 120, 180);
		expect(r.cells[3]!.el.style.insetInlineStart).toBe('auto');
		expect(r.cells[1]!.el.style.insetInlineStart).toBe('100px');
		patch?.remove();
	});

	it('returns null when no table view with the expected shape exists', () => {
		const workspace = { getLeavesOfType: () => [] };
		const app = { workspace };
		expect(installColumnPatch(app as never, () => 1)).toBeNull();
	});
});

describe('property column patch', () => {
	it('finds the property in the current column order and removes its marks when the choice changes', () => {
		const { app, row } = fakeApp();
		let property: string | null = 'note.score';
		const patch = installColumnPatch(app as never, () => 1, () => false, () => property);
		const r = row();
		Object.assign(r, { view: { config: { getOrder: () => ['file.name', 'note.other', 'note.score', 'note.date'] } } });
		r.virtualize(widths, 350, 400);
		expect(r.cells[2]!.el.hasClass(FROZEN_CLASS)).toBe(true);
		expect(r.cells[2]!.el.hasClass(LAST_CLASS)).toBe(true);
		expect(r.cells[2]!.el.style.insetInlineStart).toBe('100px');
		property = null;
		r.virtualize(widths, 350, 400);
		expect(r.cells[2]!.el.hasClass(FROZEN_CLASS)).toBe(false);
		expect(r.cells[2]!.el.hasClass(LAST_CLASS)).toBe(false);
		expect(r.el.contains(r.cells[2]!.el)).toBe(false);
		patch?.remove();
	});
	it('does not pin the wrong cell when the property is hidden or the order API changes', () => {
		const { app, row } = fakeApp();
		const patch = installColumnPatch(app as never, () => 1, () => false, () => 'note.missing');
		const r = row();
		Object.assign(r, { view: { config: { getOrder: () => ['file.name', 'note.other'] } } });
		r.virtualize(widths, 350, 400);
		expect(r.cells.filter((c) => c.el.hasClass(FROZEN_CLASS))).toHaveLength(1);
		Object.assign(r, { view: { config: { getOrder: () => { throw new Error('changed'); } } } });
		expect(() => r.virtualize(widths, 350, 400)).not.toThrow();
		patch?.remove();
	});
});
