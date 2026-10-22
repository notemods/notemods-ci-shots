import { describe, expect, it } from 'vitest';
import { positiveRules, filtersToProperties, parseSubject, parseValue, splitArgs } from '../src/filters';
import { formatDate, makeFileName, mergeProperties, plainValue, renderVariables, splitFrontmatter, uniquePath, type VarContext } from '../src/template';

const now = new Date('2026-10-10T09:05:07');
const ctx: VarContext = { title: 'Note', now, dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm', base: 'Tasks', view: 'All', template: 'Task', props: { project: '[[Apollo|Moon]]', tags: ['a', 'b'] } };

describe('filter parts', () => {
	it('flattens and and or groups and drops not groups like the app', () => {
		expect(positiveRules({ and: ['a == 1', { and: ['b == 2'] }, { or: ['c == 3'] }, { not: ['d == 4'] }] })).toEqual(['a == 1', 'b == 2', 'c == 3']);
		expect(positiveRules({ not: [{ not: ['a == 1'] }] })).toEqual(['a == 1']);
		expect(positiveRules(null)).toEqual([]);
		expect(positiveRules(' ')).toEqual([]);
	});

	it('splits arguments outside quotes and brackets', () => {
		expect(splitArgs('"a, b", [1, 2], f(x, y)')).toEqual(['"a, b"', '[1, 2]', 'f(x, y)']);
		expect(splitArgs('')).toEqual([]);
	});

	it('parses literals and leaves formulas alone', () => {
		expect(parseValue('"say \\"hi\\""')).toBe('say "hi"');
		expect(parseValue("'x'")).toBe('x');
		expect(parseValue('-2.5')).toBe(-2.5);
		expect(parseValue('[1, "a", true]')).toEqual([1, 'a', true]);
		expect(parseValue('[1, x]')).toBeUndefined();
		expect(parseValue('link("A", "Shown")')).toBe('[[A|Shown]]');
		expect(parseValue('now()', now)).toBe('2026-10-10T09:05');
		expect(parseValue('file.name')).toBeUndefined();
		expect(parseValue('null')).toBeNull();
	});

	it('reads the left side of a rule like the app', () => {
		expect(parseSubject('list(note.tags)')).toEqual({ type: 'note', name: 'tags' });
		expect(parseSubject('custom.thing')).toEqual({ type: 'note', name: 'custom.thing' });
		expect(parseSubject('file')).toEqual({ type: 'file', name: 'file' });
		expect(parseSubject('true')).toBeNull();
		expect(parseSubject('a + b')).toBeNull();
	});

	it('keeps a value that holds an operator inside quotes', () => {
		expect(filtersToProperties({ and: ['title == "a == b"'] }, undefined).properties).toEqual({ title: 'a == b' });
	});

	it('startsWith is a single value unless types.json says list', () => {
		expect(filtersToProperties('code.startsWith("AB")', undefined).properties).toEqual({ code: 'AB' });
		expect(filtersToProperties('code.startsWith("AB")', undefined, [], { types: { code: 'multitext' } }).properties).toEqual({ code: ['AB'] });
	});
});

describe('template text', () => {
	it('formats dates with moment tokens and literals', () => {
		expect(formatDate(now, 'YYYY-MM-DD HH:mm:ss')).toBe('2026-10-10 09:05:07');
		expect(formatDate(now, '[Week of] MMMM D, YY')).toBe('Week of October 10, 26');
		expect(formatDate(now, 'ddd DDDD')).toBe('Sat 283');
		expect(formatDate(new Date('2026-10-10T15:00:00'), 'hh A')).toBe('03 PM');
	});

	it('renders the core Templates variables and property values', () => {
		expect(renderVariables('{{title}} {{date}} {{time}} {{project}} {{tags}} {{base}}/{{view}} {{template}} {{nope}} {{title:x}}', ctx)).toBe('Note 2026-10-10 09:05 Moon a, b Tasks/All Task {{nope}} {{title:x}}');
	});

	it('turns property values into plain text', () => {
		expect(plainValue('[[Folder/Page#Part]]')).toBe('Page');
		expect(plainValue(null)).toBe('');
		expect(plainValue([1, null, 'x'])).toBe('1, x');
	});

	it('splits frontmatter from the body', () => {
		expect(splitFrontmatter('---\na: 1\n---\nBody')).toEqual({ yaml: 'a: 1', body: 'Body' });
		expect(splitFrontmatter('---\n---\n')).toEqual({ yaml: '', body: '' });
		expect(splitFrontmatter('No frontmatter')).toEqual({ yaml: null, body: 'No frontmatter' });
		expect(splitFrontmatter('---\nsep: a ---\nb: 1\n---\nBody')).toEqual({ yaml: 'sep: a ---\nb: 1', body: 'Body' });
		expect(splitFrontmatter('---\n\n---\nBody')).toEqual({ yaml: '', body: 'Body' });
	});

	it('merges so filter values win and blank values do not', () => {
		expect(mergeProperties({ a: 1, b: 2, tags: ['x'] }, { a: null, b: 3, c: '', tags: ['x', 'y'] })).toEqual({ a: 1, b: 3, c: '', tags: ['x', 'y'] });
	});

	it('makes safe names and finds a free path', () => {
		expect(makeFileName('...{{title}}', { ...ctx, title: '' })).toBe('Untitled');
		expect(makeFileName('x'.repeat(300), ctx)).toHaveLength(200);
		const taken = new Set(['F/A.md', 'F/A 1.md']);
		expect(uniquePath('/F/', 'A', (p) => taken.has(p))).toBe('F/A 2.md');
		expect(uniquePath('', 'A', () => false)).toBe('A.md');
	});
});
