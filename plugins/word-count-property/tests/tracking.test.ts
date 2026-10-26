import { describe, expect, it } from 'vitest';
import { changeTracking, hasConflict, hasStats, OWNERSHIP_KEY, isTracked, READING_TIME_KEY, TRACKING_KEY, WORD_COUNT_KEY, writeStats } from '../src/tracking';
import { deriveStats } from '../src/count';

describe('tracking frontmatter', () => {
	it('opts in with a strict boolean marker', () => {
		const frontmatter: Record<string, unknown> = { title: 'Draft' };
		expect(changeTracking(frontmatter, true)).toBe('enabled');
		expect(frontmatter).toEqual({ title: 'Draft', [TRACKING_KEY]: true });
	});

	it('does not opt in when wordCount already exists', () => {
		const frontmatter: Record<string, unknown> = { [WORD_COUNT_KEY]: 25 };
		expect(changeTracking(frontmatter, true)).toBe('conflict');
		expect(frontmatter).toEqual({ [WORD_COUNT_KEY]: 25 });
	});

	it('does not opt in when readingTimeMinutes already exists', () => {
		const frontmatter: Record<string, unknown> = { [READING_TIME_KEY]: 3 };
		expect(changeTracking(frontmatter, true)).toBe('conflict');
		expect(frontmatter).toEqual({ [READING_TIME_KEY]: 3 });
	});

	it('does not change an already tracked note', () => {
		const frontmatter: Record<string, unknown> = { [TRACKING_KEY]: true, [WORD_COUNT_KEY]: 10 };
		expect(changeTracking(frontmatter, true)).toBe('conflict');
		expect(frontmatter[WORD_COUNT_KEY]).toBe(10);
	});

	it('removes generated fields but keeps unrelated properties when disabled', () => {
		const frontmatter: Record<string, unknown> = { title: 'Draft', [TRACKING_KEY]: true, [WORD_COUNT_KEY]: 10, [READING_TIME_KEY]: 2, [OWNERSHIP_KEY]: 'source-v1:10:2' };
		expect(changeTracking(frontmatter, false)).toBe('disabled');
		expect(frontmatter).toEqual({ title: 'Draft' });
	});

	it('does not mutate an already disabled note', () => {
		const frontmatter: Record<string, unknown> = { title: 'Draft' };
		expect(changeTracking(frontmatter, false)).toBe('already-disabled');
		expect(frontmatter).toEqual({ title: 'Draft' });
	});

	it('writes numeric values to opted-in fields', () => {
		const frontmatter: Record<string, unknown> = { [TRACKING_KEY]: true };
		const changed = writeStats(frontmatter, deriveStats('One two'));
		expect(changed).toBe(true);
		expect(frontmatter[WORD_COUNT_KEY]).toBe(2);
		expect(frontmatter[READING_TIME_KEY]).toBe(1);
		expect(typeof frontmatter[WORD_COUNT_KEY]).toBe('number');
		expect(typeof frontmatter[READING_TIME_KEY]).toBe('number');
	});

	it('does not write values for notes without the marker', () => {
		const frontmatter: Record<string, unknown> = { title: 'Draft' };
		expect(writeStats(frontmatter, deriveStats('One two'))).toBe(false);
		expect(frontmatter).toEqual({ title: 'Draft' });
	});

	it('does not rewrite unchanged numeric values', () => {
		const frontmatter: Record<string, unknown> = { [TRACKING_KEY]: true, [WORD_COUNT_KEY]: 2, [READING_TIME_KEY]: 1, [OWNERSHIP_KEY]: 'source-v1:2:1' };
		expect(writeStats(frontmatter, deriveStats('One two'))).toBe(false);
	});

	it('writes zero for a tracked empty note', () => {
		const frontmatter: Record<string, unknown> = { [TRACKING_KEY]: true };
		writeStats(frontmatter, deriveStats(''));
		expect(frontmatter[WORD_COUNT_KEY]).toBe(0);
		expect(frontmatter[READING_TIME_KEY]).toBe(0);
	});

	it('recognizes only a boolean true marker', () => {
		expect(isTracked({ [TRACKING_KEY]: true })).toBe(true);
		expect(isTracked({ [TRACKING_KEY]: 'true' })).toBe(false);
		expect(isTracked({ [TRACKING_KEY]: 1 })).toBe(false);
		expect(isTracked(null)).toBe(false);
		expect(isTracked('note')).toBe(false);
	});

	it('matches only both expected numbers', () => {
		const stats = deriveStats('One two');
		expect(hasStats({ [TRACKING_KEY]: true, [WORD_COUNT_KEY]: 2, [READING_TIME_KEY]: 1, [OWNERSHIP_KEY]: 'source-v1:2:1' }, stats)).toBe(true);
		expect(hasStats({ [TRACKING_KEY]: true, [WORD_COUNT_KEY]: '2', [READING_TIME_KEY]: 1, [OWNERSHIP_KEY]: 'source-v1:2:1' }, stats)).toBe(false);
		expect(hasStats(undefined, stats)).toBe(false);
	});
});


describe('ownership across devices and manual edits', () => {
	it.each([{wordCount: 9}, {readingTimeMinutes: 3}, {wordCount: 9, readingTimeMinutes: 3}])('refuses hand-added tracking with foreign values %j', (foreign) => {
		const fm = { wordCountTracked: true, ...foreign };
		const before = { ...fm };
		expect(hasConflict(fm)).toBe(true);
		expect(writeStats(fm, deriveStats('one two'))).toBe(false);
		expect(fm).toEqual(before);
	});

	it('preserves foreign values when tracking is disabled', () => {
		const fm = { wordCountTracked: true, wordCount: 99, readingTimeMinutes: 4 };
		changeTracking(fm, false);
		expect(fm).toEqual({ wordCount: 99, readingTimeMinutes: 4 });
	});

	it('refuses an output changed by another workflow after ownership was established', () => {
		const fm: Record<string, unknown> = { wordCountTracked: true };
		writeStats(fm, deriveStats('one two'));
		fm.wordCount = 999;
		expect(writeStats(fm, deriveStats('one two three'))).toBe(false);
		expect(fm.wordCount).toBe(999);
		changeTracking(fm, false);
		expect(fm.wordCount).toBe(999);
	});

	it('does not recreate fields after opt-out and a later edit', () => {
		const fm: Record<string, unknown> = { wordCountTracked: true };
		writeStats(fm, deriveStats('one two'));
		changeTracking(fm, false);
		expect(writeStats(fm, deriveStats('one two three'))).toBe(false);
		expect(fm).toEqual({});
	});
});
