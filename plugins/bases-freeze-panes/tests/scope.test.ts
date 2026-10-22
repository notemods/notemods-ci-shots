import { describe, expect, it } from 'vitest';
import vectors from './vectors/bases-freeze-panes.json';
import { DEFAULT_SETTINGS, MAX_VIEWS, effectiveFor, normalizeSettings, removeFile, renameFile, withFileChoice, withoutFileLevel, withViewChoice, type FreezeSettings, type ViewChoice } from '../src/scope';

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

describe('golden vectors for view choices (function effectiveFor)', () => {
	const cases = (vectors.cases as { name: string; function?: string; args: unknown[]; expected: unknown }[]).filter((c) => c.function === 'effectiveFor');
	it('has the six acceptance cases of the view spec', () => {
		for (let n = 1; n <= 6; n++) expect(cases.some((c) => c.name.startsWith(`view choice ${n}:`))).toBe(true);
	});
	for (const c of cases) {
		it(c.name, () => {
			const [settings, path, pro, view] = c.args as [FreezeSettings, string | null, boolean, string | null];
			expect(effectiveFor(settings, path, pro, view)).toEqual(c.expected);
		});
	}
});

describe('view choices', () => {
	const wide = (choice: ViewChoice) => withViewChoice(DEFAULT_SETTINGS, 'Books.base', 'Wide', choice);

	it('AC1 and AC2: view columns need Pro and other views keep the global count', () => {
		const s = wide({ columns: 3 });
		expect(effectiveFor(s, 'Books.base', true, 'Wide').columns).toBe(3);
		expect(effectiveFor(s, 'Books.base', true, 'Narrow').columns).toBe(1);
		expect(effectiveFor(s, 'Books.base', false, 'Wide').columns).toBe(1);
	});

	it('view columns win over file columns, and file columns apply to views without a count', () => {
		let s = withFileChoice(DEFAULT_SETTINGS, 'Books.base', { columns: 2 });
		s = withViewChoice(s, 'Books.base', 'Wide', { columns: 0 });
		expect(effectiveFor(s, 'Books.base', true, 'Wide').columns).toBe(0);
		expect(effectiveFor(s, 'Books.base', true, 'Other').columns).toBe(2);
	});

	it('AC3: a view header choice wins over the global header in both directions (free)', () => {
		expect(effectiveFor(wide({ header: false }), 'Books.base', false, 'Wide').header).toBe(false);
		expect(effectiveFor(wide({ header: false }), 'Books.base', false, 'Narrow').header).toBe(true);
		const s = withViewChoice({ ...DEFAULT_SETTINGS, freezeHeader: false }, 'Books.base', 'Wide', { header: true });
		expect(effectiveFor(s, 'Books.base', false, 'Wide').header).toBe(true);
		expect(effectiveFor(s, 'Books.base', false, 'Narrow').header).toBe(false);
	});

	it('AC4 and AC5: view off and file off both turn the view off; the main switch is first', () => {
		const off = withViewChoice(withFileChoice(DEFAULT_SETTINGS, 'Books.base', { columns: 2 }), 'Books.base', 'Wide', { off: true });
		expect(effectiveFor(off, 'Books.base', true, 'Wide')).toEqual({ header: false, columns: 0, last: false });
		expect(effectiveFor(off, 'Books.base', false, 'Wide')).toEqual({ header: false, columns: 0, last: false });
		const fileOff = withFileChoice(wide({ header: true, columns: 3 }), 'Books.base', { off: true, views: wide({ header: true, columns: 3 }).files['Books.base']?.views });
		expect(effectiveFor(fileOff, 'Books.base', true, 'Wide')).toEqual({ header: false, columns: 0, last: false });
		expect(effectiveFor({ ...wide({ columns: 3 }), enabled: false }, 'Books.base', true, 'Wide')).toEqual({ header: false, columns: 0, last: false });
	});

	it('AC6: a null or empty view name gives exactly the file result', () => {
		let s = withFileChoice({ ...DEFAULT_SETTINGS, freezeLast: true }, 'Books.base', { columns: 2 });
		s = withViewChoice(s, 'Books.base', 'Wide', { off: true });
		for (const pro of [false, true]) {
			expect(effectiveFor(s, 'Books.base', pro, null)).toEqual(effectiveFor(s, 'Books.base', pro));
			expect(effectiveFor(s, 'Books.base', pro, '')).toEqual(effectiveFor(s, 'Books.base', pro));
		}
		expect(effectiveFor(s, null, true, 'Wide')).toEqual(effectiveFor(s, null, true));
	});

	it('does not read Object prototype keys as view names', () => {
		const s = wide({ columns: 3 });
		expect(effectiveFor(s, 'Books.base', true, 'constructor').columns).toBe(1);
		expect(effectiveFor(s, 'Books.base', true, 'toString').columns).toBe(1);
		const proto = withViewChoice(DEFAULT_SETTINGS, 'Books.base', '__proto__', { off: true });
		expect(Object.keys(proto.files['Books.base']?.views ?? {})).toEqual(['__proto__']);
		expect(effectiveFor(proto, 'Books.base', true, '__proto__').columns).toBe(0);
		expect(effectiveFor(proto, 'Books.base', true, 'Wide').columns).toBe(1);
		expect(normalizeSettings(JSON.parse(JSON.stringify(proto)))).toEqual(proto);
	});

	it('keeps the file choice when a view choice is set or removed, and drops an empty entry', () => {
		let s = withFileChoice(DEFAULT_SETTINGS, 'Books.base', { columns: 2 });
		s = withViewChoice(s, 'Books.base', 'Wide', { header: false });
		expect(s.files['Books.base']).toEqual({ columns: 2, views: { Wide: { header: false } } });
		s = withViewChoice(s, 'Books.base', 'Wide', null);
		expect(s.files['Books.base']).toEqual({ columns: 2 });
		s = withViewChoice(withFileChoice(s, 'Books.base', {}), 'Books.base', 'Wide', { off: true });
		expect(s.files).toEqual({ 'Books.base': { views: { Wide: { off: true } } } });
		expect(withViewChoice(s, 'Books.base', 'Wide', {}).files).toEqual({});
	});

	it('the file switch keeps the view choices', () => {
		let s = wide({ columns: 3 });
		s = withFileChoice(s, 'Books.base', { ...s.files['Books.base'], off: true });
		expect(s.files['Books.base']).toEqual({ off: true, views: { Wide: { columns: 3 } } });
		s = withoutFileLevel(s, 'Books.base');
		expect(s.files['Books.base']).toEqual({ views: { Wide: { columns: 3 } } });
	});

	it('AC9 support: view choices move with a renamed file or folder and go with a deleted file', () => {
		let s = withViewChoice(DEFAULT_SETTINGS, 'Shelf/Books.base', 'Wide', { columns: 3 });
		s = withViewChoice(s, 'Shelf/Books.base', 'Narrow', { off: true });
		const renamed = renameFile(s, 'Shelf/Books.base', 'Shelf/Library.base');
		expect(renamed.files).toEqual({ 'Shelf/Library.base': { views: { Wide: { columns: 3 }, Narrow: { off: true } } } });
		expect(renameFile(s, 'Shelf', 'Archive').files).toEqual({ 'Archive/Books.base': s.files['Shelf/Books.base'] });
		expect(removeFile(renamed, 'Shelf/Library.base').files).toEqual({});
	});

	it('keeps at most 50 views for each file', () => {
		let s = DEFAULT_SETTINGS;
		for (let i = 0; i < MAX_VIEWS; i++) s = withViewChoice(s, 'a.base', `View ${i}`, { off: true });
		expect(Object.keys(s.files['a.base']?.views ?? {})).toHaveLength(50);
		expect(withViewChoice(s, 'a.base', 'View 50', { off: true })).toBe(s);
		// A view that is already in the list can still change.
		expect(withViewChoice(s, 'a.base', 'View 3', { header: false }).files['a.base']?.views?.['View 3']).toEqual({ header: false });
		const many = Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`V${i}`, { off: true }]));
		expect(Object.keys(normalizeSettings({ files: { 'a.base': { views: many } } }).files['a.base']?.views ?? {})).toHaveLength(50);
	});

	it('keeps at most 1000 file entries, as before', () => {
		const files = Object.fromEntries(Array.from({ length: 1100 }, (_, i) => [`f${i}.base`, { views: { Wide: { off: true } } }]));
		expect(Object.keys(normalizeSettings({ files }).files)).toHaveLength(1000);
	});

	it('normalizes stored view choices and drops bad values', () => {
		const s = normalizeSettings({
			files: {
				'a.base': { views: { Wide: { columns: '3', header: 'no' }, Off: { off: true }, Bad: { columns: 'x' }, '': { off: true }, Num: 5 } },
				'b.base': { views: 'Wide' },
			},
		});
		expect(s.files).toEqual({ 'a.base': { views: { Wide: { columns: 3 }, Off: { off: true } } } });
	});

	it('old data without views loads unchanged', () => {
		const old = { columns: 2, files: { 'a.base': { off: true }, 'b.md': { columns: 3 } } };
		expect(normalizeSettings(old).files).toEqual(old.files);
	});
});
