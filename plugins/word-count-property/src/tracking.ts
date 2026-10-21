import type { WordCountStats } from './count';

export const OWNERSHIP_KEY = 'wordCountPropertyStamp';

export const TRACKING_KEY = 'wordCountTracked';
export const WORD_COUNT_KEY = 'wordCount';
export const READING_TIME_KEY = 'readingTimeMinutes';

export type TrackingChange = 'enabled' | 'disabled' | 'already-enabled' | 'already-disabled' | 'conflict';

/** Enables tracking without replacing a property that the note already owns. */
export function changeTracking(frontmatter: Record<string, unknown>, enabled: boolean): TrackingChange {
	if (enabled) {
		if (frontmatter[TRACKING_KEY] === true) return hasConflict(frontmatter) ? 'conflict' : 'already-enabled';
		if (hasOwn(frontmatter, WORD_COUNT_KEY) || hasOwn(frontmatter, READING_TIME_KEY)) return 'conflict';
		frontmatter[TRACKING_KEY] = true;
		return 'enabled';
	}
	if (frontmatter[TRACKING_KEY] !== true) return 'already-disabled';
	if (!hasConflict(frontmatter)) {
		delete frontmatter[WORD_COUNT_KEY];
		delete frontmatter[READING_TIME_KEY];
	}
	delete frontmatter[TRACKING_KEY];
	delete frontmatter[OWNERSHIP_KEY];
	return 'disabled';
}

/** Writes computed numeric values only to a note that opted in. */
export function writeStats(frontmatter: Record<string, unknown>, stats: WordCountStats): boolean {
	if (frontmatter[TRACKING_KEY] !== true || hasConflict(frontmatter)) return false;
	let changed = false;
	if (frontmatter[WORD_COUNT_KEY] !== stats.wordCount) {
		frontmatter[WORD_COUNT_KEY] = stats.wordCount;
		changed = true;
	}
	if (frontmatter[READING_TIME_KEY] !== stats.readingTimeMinutes) {
		frontmatter[READING_TIME_KEY] = stats.readingTimeMinutes;
		changed = true;
	}
	frontmatter[OWNERSHIP_KEY] = stamp(stats.wordCount, stats.readingTimeMinutes);
	return changed;
}

export function hasStats(frontmatter: Record<string, unknown> | undefined, stats: WordCountStats): boolean {
	return frontmatter?.[TRACKING_KEY] === true
		&& !hasConflict(frontmatter)
		&& frontmatter[WORD_COUNT_KEY] === stats.wordCount
		&& frontmatter[READING_TIME_KEY] === stats.readingTimeMinutes;
}

export function isTracked(frontmatter: unknown): boolean {
	return typeof frontmatter === 'object' && frontmatter !== null
		&& (frontmatter as Record<string, unknown>)[TRACKING_KEY] === true;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(value, key);
}

/** A copied opt-in marker is not proof that existing values belong to us. */
export function hasConflict(frontmatter: Record<string, unknown>): boolean {
	if (!hasOwn(frontmatter, WORD_COUNT_KEY) && !hasOwn(frontmatter, READING_TIME_KEY)) return hasOwn(frontmatter, OWNERSHIP_KEY);
	return typeof frontmatter[WORD_COUNT_KEY] !== 'number' || typeof frontmatter[READING_TIME_KEY] !== 'number'
		|| frontmatter[OWNERSHIP_KEY] !== stamp(frontmatter[WORD_COUNT_KEY], frontmatter[READING_TIME_KEY]);
}

function stamp(words: unknown, minutes: unknown): string {
	return `source-v1:${String(words)}:${String(minutes)}`;
}
