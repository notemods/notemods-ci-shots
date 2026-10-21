import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, effectiveFor, normalizeSettings, removeFile, renameFile, withFileChoice } from '../src/scope';

describe('effectiveFor', () => {
	it('uses the defaults for a file without a choice', () => {
		expect(effectiveFor(DEFAULT_SETTINGS, 'Books.base')).toEqual({ header: true, columns: 1, last: false });
		expect(effectiveFor(DEFAULT_SETTINGS, null, true)).toEqual({ header: true, columns: 1, last: false });
	});

	it('turns everything off with the main switch', () => {
		expect(effectiveFor({ ...DEFAULT_SETTINGS, enabled: false, freezeLast: true }, 'Books.base', true)).toEqual({ header: false, columns: 0, last: false });
	});

	it('turns everything off for a file that is switched off, with or without Pro (free)', () => {
		const s = withFileChoice(DEFAULT_SETTINGS, 'Books.base', { off: true });
		expect(effectiveFor(s, 'Books.base')).toEqual({ header: false, columns: 0, last: false });
		expect(effectiveFor(s, 'Other.base')).toEqual({ header: true, columns: 1, last: false });
	});

	it('Pro: uses the column count chosen for one file', () => {
		const s = withFileChoice(DEFAULT_SETTINGS, 'Projects.md', { columns: 3 });
		expect(effectiveFor(s, 'Projects.md', true)).toEqual({ header: true, columns: 3, last: false });
	});

	it('free: ignores the per-file column count and caps columns at 1, but keeps the saved choice', () => {
		const s = withFileChoice({ ...DEFAULT_SETTINGS, columns: 3 }, 'Projects.md', { columns: 0 });
		expect(effectiveFor(s, 'Projects.md')).toEqual({ header: true, columns: 1, last: false });
		expect(effectiveFor(s, 'Other.md')).toEqual({ header: true, columns: 1, last: false });
		expect(s.files['Projects.md']).toEqual({ columns: 0 });
		expect(effectiveFor(s, 'Projects.md', true).columns).toBe(0);
	});

	it('free: 0 frozen columns stays 0', () => {
		expect(effectiveFor({ ...DEFAULT_SETTINGS, columns: 0 }, 'a.base')).toEqual({ header: true, columns: 0, last: false });
	});

	it('the pinned last column needs Pro', () => {
		const s = { ...DEFAULT_SETTINGS, freezeLast: true };
		expect(effectiveFor(s, 'a.base').last).toBe(false);
		expect(effectiveFor(s, 'a.base', true).last).toBe(true);
	});

	it('keeps the header setting separate from the columns', () => {
		expect(effectiveFor({ ...DEFAULT_SETTINGS, freezeHeader: false, columns: 2 }, 'a.base', true)).toEqual({ header: false, columns: 2, last: false });
	});
});

describe('file choices', () => {
	it('removes the entry when the choice is empty', () => {
		const s = withFileChoice(withFileChoice(DEFAULT_SETTINGS, 'a.base', { off: true }), 'a.base', { off: false });
		expect(s.files).toEqual({});
	});

	it('moves the choice when a file is renamed', () => {
		const s = renameFile(withFileChoice(DEFAULT_SETTINGS, 'old.base', { columns: 2 }), 'old.base', 'new/new.base');
		expect(s.files).toEqual({ 'new/new.base': { columns: 2 } });
	});

	it('leaves settings alone when the renamed file had no choice', () => {
		expect(renameFile(DEFAULT_SETTINGS, 'x.base', 'y.base')).toBe(DEFAULT_SETTINGS);
	});

	it('does not read Object prototype keys as file choices', () => {
		expect(renameFile(DEFAULT_SETTINGS, 'constructor', 'Archive')).toBe(DEFAULT_SETTINGS);
		expect(removeFile(DEFAULT_SETTINGS, 'toString')).toBe(DEFAULT_SETTINGS);
	});

	it('moves the choices of the files in a renamed folder', () => {
		let s = withFileChoice(DEFAULT_SETTINGS, 'Books/a.base', { columns: 2 });
		s = withFileChoice(s, 'Books/Old/b.md', { off: true });
		s = withFileChoice(s, 'Books2/c.base', { off: true });
		s = renameFile(s, 'Books', 'Library');
		expect(s.files).toEqual({ 'Library/a.base': { columns: 2 }, 'Library/Old/b.md': { off: true }, 'Books2/c.base': { off: true } });
		// The rename event of each file in the folder then finds nothing to move.
		expect(renameFile(s, 'Books/a.base', 'Library/a.base')).toBe(s);
	});

	it('removes the choice of a deleted file, so a new file at that path starts with the defaults', () => {
		const s = withFileChoice(withFileChoice(DEFAULT_SETTINGS, 'a.base', { off: true }), 'b.base', { columns: 2 });
		expect(removeFile(s, 'a.base').files).toEqual({ 'b.base': { columns: 2 } });
		expect(removeFile(s, 'x.base')).toBe(s);
	});

	it('removes the choices of the files in a deleted folder', () => {
		let s = withFileChoice(DEFAULT_SETTINGS, 'Books/a.base', { off: true });
		s = withFileChoice(s, 'Books/Old/b.md', { columns: 1 });
		s = withFileChoice(s, 'Books.base', { off: true });
		expect(removeFile(s, 'Books').files).toEqual({ 'Books.base': { off: true } });
	});
});

describe('normalizeSettings', () => {
	it('keeps note tables off for old data and accepts only a boolean choice', () => {
		expect(normalizeSettings({ columns: 2 }).freezeNoteTables).toBe(false);
		expect(normalizeSettings({ freezeNoteTables: 'yes' }).freezeNoteTables).toBe(false);
		expect(normalizeSettings({ freezeNoteTables: true }).freezeNoteTables).toBe(true);
	});
	it('returns the defaults for empty or broken data', () => {
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings('text')).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
	});

	it('repairs wrong types and out of range values', () => {
		expect(normalizeSettings({ enabled: 'yes', columns: 12, embedHeight: 20, freezeHeader: 0, freezeLast: 'on' })).toEqual({ ...DEFAULT_SETTINGS, columns: 3, embedHeight: 200 });
		expect(normalizeSettings({ freezeLast: true }).freezeLast).toBe(true);
		expect(normalizeSettings({ embedHeight: 99999 }).embedHeight).toBe(1200);
	});

	it('drops file choices that carry nothing usable', () => {
		const s = normalizeSettings({ files: { 'a.base': { off: true }, 'b.base': { columns: 'two' }, 'c.base': 5, '': { off: true }, 'd.md': { columns: 2 } } });
		expect(s.files).toEqual({ 'a.base': { off: true }, 'd.md': { columns: 2 } });
	});
});
