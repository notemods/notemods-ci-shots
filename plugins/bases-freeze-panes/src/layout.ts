// Pure layout logic for frozen columns. No Obsidian imports, so vitest and the golden vectors
// in packages/spec/vectors/bases-freeze-panes.json run it directly.

/** Most columns a user can freeze. More than 3 would cover most of a narrow pane. */
export const MAX_FROZEN = 3;

export interface PlannedCell {
	/** Column index in the table's column order. */
	index: number;
	/** Display offset in pixels from the start edge of the table. */
	start: number;
	width: number;
	frozen: boolean;
}

export interface RowPlan {
	/** Leading frozen columns after clamping, plus the optional chosen property. */
	frozen: number;
	/** Index of the last column when it is pinned to the end edge (Pro), else null. */
	end: number | null;
	/** Cells to keep in source order. Frozen cells stay in the flex flow. Other cells use absolute offsets. */
	cells: PlannedCell[];
}

/** Turns any stored value into a whole number of frozen columns from 0 to MAX_FROZEN. */
export function clampColumns(value: unknown, fallback: number): number {
	const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
	if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
	return Math.min(MAX_FROZEN, Math.max(0, Math.round(n)));
}

/**
 * Plans one table row. A column stays in the row when it is frozen, or when any part of it lies
 * between left and right (the same test the core table uses, so the visible cells do not change).
 * pinLast keeps the last column too and pins it to the end edge, unless it is already a frozen column.
 * pinIndex moves a visible property next to the leading columns without a change to the file's order.
 * Returns null when the widths are not usable numbers; the caller then leaves the row to the core code.
 */
export function planRow(widths: readonly number[], frozen: number, left: number, right: number, pinLast = false, pinIndex: number | null = null): RowPlan | null {
	if (!Array.isArray(widths) || !Number.isFinite(left) || !Number.isFinite(right)) return null;
	const list: number[] = [];
	for (const w of widths as readonly unknown[]) {
		if (typeof w !== 'number' || !Number.isFinite(w) || w < 0) return null;
		list.push(w);
	}
	const count = Math.min(clampColumns(frozen, 0), list.length);
	const pinned = pinIndex !== null && Number.isInteger(pinIndex) && pinIndex >= count && pinIndex < list.length ? pinIndex : null;
	const last = pinLast === true && list.length - 1 >= count && list.length - 1 !== pinned ? list.length - 1 : null;
	const leadingWidth = list.slice(0, count).reduce((sum, width) => sum + width, 0);
	const cells: PlannedCell[] = [];
	let start = 0;
	list.forEach((width, index) => {
		// Move the chosen field next to the leading columns. Move the intervening
		// cells right by its width, so they remain reachable instead of staying
		// permanently underneath the pinned field. The base file order stays as is.
		const offset = index === pinned ? leadingWidth : pinned !== null && index >= count && index < pinned ? start + list[pinned]! : start;
		const end = offset + width;
		const isFrozen = index < count || index === pinned;
		if (isFrozen || index === last || (end >= left && offset <= right)) cells.push({ index, start: offset, width, frozen: isFrozen });
		start += width;
	});
	return { frozen: count + (pinned === null ? 0 : 1), end: last, cells };
}
