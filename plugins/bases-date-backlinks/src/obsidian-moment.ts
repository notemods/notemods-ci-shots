import * as obsidian from 'obsidian';

export interface MomentLike {
	clone(): MomentLike;
	endOf(unit: 'day' | 'week' | 'isoWeek' | 'month'): MomentLike;
	format(format: string): string;
	isValid(): boolean;
	startOf(unit: 'day' | 'week' | 'isoWeek' | 'month'): MomentLike;
}

type MomentFn = ((input?: unknown, format?: unknown, strict?: boolean) => MomentLike) & {
	ISO_8601: unknown;
};

/** Uses the Moment instance that Obsidian already bundles without depending on its typings. */
export function getObsidianMoment(): MomentFn {
	const candidate = (obsidian as unknown as { moment?: MomentFn }).moment;
	if (typeof candidate !== 'function') throw new Error('Date Property Backlinks: Obsidian moment is not available.');
	return candidate;
}
