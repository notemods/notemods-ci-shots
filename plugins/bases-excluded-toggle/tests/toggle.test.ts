import { describe, expect, it } from 'vitest';
import vectors from './vectors/bases-excluded-toggle.json';
import { applyPresetFilters, mergeFilters, parseFilterList, restoreFilters, runOp, toggleFilters } from '../src/toggle';

describe('golden vectors', () => {
	for (const vector of vectors.cases) {
		it(vector.name, () => expect(runOp(vector.args[0] as Parameters<typeof runOp>[0])).toEqual(vector.expected));
	}
});

describe('toggle state transitions', () => {
	it('clears the native list and stores a copy for restore', () => {
		expect(toggleFilters(['Archive/', '/^_/'], null)).toEqual({ action: 'show', nextFilters: [], savedFilters: ['Archive/', '/^_/'] });
	});
	it('restores the saved list on the second toggle', () => {
		expect(toggleFilters([], ['Archive/'])).toEqual({ action: 'hide', nextFilters: ['Archive/'], savedFilters: null });
	});
	it('merges a newly added pattern on restore', () => {
		expect(toggleFilters(['Templates/'], ['Archive/']).nextFilters).toEqual(['Archive/', 'Templates/']);
	});
	it('merges a newly added pattern on unload', () => {
		expect(restoreFilters(['Templates/'], ['Archive/'])).toEqual(['Archive/', 'Templates/']);
	});
	it('does not restore when no temporary list exists', () => {
		expect(restoreFilters(['Archive/'], null)).toBeNull();
	});
	it('does not clear an already empty native list', () => {
		expect(toggleFilters([], null)).toEqual({ action: 'empty', nextFilters: [], savedFilters: null });
	});
	it('treats a saved empty list as an active visible state', () => {
		expect(toggleFilters(['Added/'], []).nextFilters).toEqual(['Added/']);
	});
	it('restores an empty saved list without adding values', () => {
		expect(toggleFilters([], []).nextFilters).toEqual([]);
	});
	it('keeps file patterns as exact strings', () => {
		expect(toggleFilters(['Archive/note.md'], null).savedFilters).toEqual(['Archive/note.md']);
	});
	it('keeps regex patterns as exact strings', () => {
		expect(toggleFilters(['/^_/'], null).savedFilters).toEqual(['/^_/']);
	});
	it('keeps folder patterns as exact strings', () => {
		expect(toggleFilters(['Archive/'], null).savedFilters).toEqual(['Archive/']);
	});
});

describe('filter merging', () => {
	it('keeps the first list before later lists', () => {
		expect(mergeFilters(['A/'], ['B/'])).toEqual(['A/', 'B/']);
	});
	it('keeps the first occurrence of a duplicate', () => {
		expect(mergeFilters(['A/', 'B/'], ['B/', 'C/'])).toEqual(['A/', 'B/', 'C/']);
	});
	it('handles any number of empty lists', () => {
		expect(mergeFilters([], [], [])).toEqual([]);
	});
	it('keeps distinct regex patterns', () => {
		expect(mergeFilters(['/^a/'], ['/^b/'])).toEqual(['/^a/', '/^b/']);
	});
	it('keeps case-sensitive paths distinct', () => {
		expect(mergeFilters(['Archive/'], ['archive/'])).toEqual(['Archive/', 'archive/']);
	});
	it('keeps whitespace as part of a native pattern', () => {
		expect(mergeFilters(['Research Notes/'])).toEqual(['Research Notes/']);
	});
	it('keeps file and folder patterns distinct', () => {
		expect(mergeFilters(['Archive/'], ['Archive/note.md'])).toEqual(['Archive/', 'Archive/note.md']);
	});
	it('restores current entries when the saved list is empty', () => {
		expect(mergeFilters([], ['Added/'])).toEqual(['Added/']);
	});
	it('rejects an unsupported non-list setting value', () => {
		expect(parseFilterList({ pattern: 'Archive/' })).toBeNull();
	});
	it('rejects a list that contains a non-string entry', () => {
		expect(parseFilterList(['Archive/', 5])).toBeNull();
	});
	it('accepts an empty native list', () => {
		expect(parseFilterList([])).toEqual([]);
	});
	it('applies a named preset and clears a temporary saved list', () => {
		expect(applyPresetFilters({ Archive: ['Archive/'] }, 'Archive')).toEqual({ nextFilters: ['Archive/'], savedFilters: null });
	});
	it('keeps duplicate preset entries once', () => {
		expect(applyPresetFilters({ Archive: ['Archive/', 'Archive/'] }, 'Archive')).toEqual({ nextFilters: ['Archive/'], savedFilters: null });
	});
	it('returns null for an unknown preset', () => {
		expect(applyPresetFilters({ Archive: ['Archive/'] }, 'Missing')).toBeNull();
	});
	it('does not mutate the source arrays', () => {
		const a = ['A/'];
		const b = ['B/'];
		mergeFilters(a, b);
		expect(a).toEqual(['A/']);
		expect(b).toEqual(['B/']);
	});
});
