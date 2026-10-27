import { describe, expect, it } from 'vitest';
import vectors from './vectors/tag-properties.json';
import { activeProperties, basesFilter, buildIndex, listTags, matchingPaths, normalizeTag, noteTags, propertyNames } from '../src/tags';


describe('golden acceptance cases', () => {
	for (const test of vectors.cases) it(test.name, () => expect(buildIndex(...test.args as Parameters<typeof buildIndex>)).toEqual(test.expected));
	for (const test of vectors.listCases) it(test.name, () => expect(listTags(test.args[0])).toEqual(test.expected));
	for (const test of vectors.filterCases) it(test.name, () => expect(basesFilter(...test.args as Parameters<typeof basesFilter>)).toEqual(test.expected));
	for (const test of vectors.matchingCases) it(test.name, () => expect(matchingPaths(...test.args as Parameters<typeof matchingPaths>)).toEqual(test.expected));
});
describe('tag normalization', () => {
	it.each([
		['#Work/Review', 'work/review'], [' café ', 'café'], ['你好/主题', '你好/主题'], ['123_a', '123_a'], ['a-b', 'a-b'],
		['a//b', null], ['/a', null], ['a/', null], ['##a', null], ['a b', null], ['123', null], ['123/456', null],
		['https://example.com', null], ['[[Project]]', null], ['a,b', null], [true, null], [null, null], [{ a: 1 }, null],
	])('normalizes %j', (input, expected) => expect(normalizeTag(input)).toBe(expected));
});
const notes = [
	{ path: 'A.md', frontmatter: { topics: ['#Work', 'work', 'work/review'], company: ['Acme'] }, coreTags: ['#work', '#other'] },
	{ path: 'B.md', frontmatter: { topics: ['WORK', 'workshop'], company: ['work'] }, coreTags: ['#work'] },
	{ path: 'C.md', frontmatter: { topics: 'work', company: [3] }, coreTags: ['#other'] },
];
describe('property selection and indexing', () => {
	it('uses one property for free', () => expect(activeProperties('topics,company', false)).toEqual(['topics']));
	it('uses all properties for Pro', () => expect(activeProperties('topics,company', true)).toEqual(['topics', 'company']));
	it('trims names and removes duplicates and reserved names', () => expect(propertyNames(' topics, topics\ncompany,tags,__proto__,constructor,prototype')).toEqual(['topics', 'company']));
	it('allows no chosen properties', () => expect(propertyNames('')).toEqual([]));
	it('falls back safely for malformed saved names', () => expect(propertyNames(3)).toEqual(['topics']));
	it('counts notes once per tag', () => expect(buildIndex(notes, ['topics']).find((r) => r.tag === 'work')).toEqual({ tag: 'work', paths: ['A.md', 'B.md'], properties: ['topics'] }));
	it('keeps property provenance and deduplicates across properties', () => expect(buildIndex(notes, ['topics', 'company']).find((r) => r.tag === 'work')).toEqual({ tag: 'work', paths: ['A.md', 'B.md'], properties: ['company', 'topics'] }));
	it('does not include core tags by default', () => expect(buildIndex(notes, ['topics']).some((r) => r.tag === 'other')).toBe(false));
	it('combines core and custom while counting each note once', () => expect(buildIndex(notes, ['topics'], true).find((r) => r.tag === 'work')?.paths).toEqual(['A.md', 'B.md']));
	it('supports core-only tags in the combined view', () => expect(buildIndex(notes, ['topics'], true).find((r) => r.tag === 'other')?.paths).toEqual(['A.md', 'C.md']));
	it('never reads inherited frontmatter', () => expect(noteTags({ path: 'a', frontmatter: Object.create({ topics: ['work'] }) }, ['topics']).size).toBe(0));
	it('matches exactly by default', () => expect(matchingPaths(buildIndex(notes, ['topics']), 'work')).toEqual(['A.md', 'B.md']));
	it('matches children without matching similar prefixes', () => expect(matchingPaths([{ tag: 'work/review', paths: ['C.md'], properties: ['topics'] }, { tag: 'workshop', paths: ['D.md'], properties: ['topics'] }], 'work', true)).toEqual(['C.md']));
	it('reflects edits and deletions on a fresh index', () => expect(buildIndex(notes.slice(1), ['topics']).find((r) => r.tag === 'work')?.paths).toEqual(['B.md']));
	it('handles an empty vault', () => expect(buildIndex([], ['topics'])).toEqual([]));
});
describe('native Bases expressions', () => {
	it('guards list and string types and folds case', () => {
		const expression = basesFilter(['topics'], '#Work');
		expect(expression).toContain('note["topics"].isType("list")');
		expect(expression).toContain('if(value.isType("string")');
		expect(expression).toContain('value.trim().replace(/^#/, "").lower() == "work"');
		expect(expression).not.toContain('startsWith');
	});
	it('adds a slash-delimited descendant comparison', () => expect(basesFilter(['topics'], 'work', true)).toContain('startsWith("work/")'));
	it('escapes quotes in property names', () => expect(basesFilter(['a"b\\c'], 'work')).toContain('note["a\\"b\\\\c"]'));
	it('joins selected properties with or', () => expect(basesFilter(['topics', 'company'], 'work').split(' || ').length).toBe(2));
	it('uses exact core tag comparison too', () => expect(basesFilter(['topics'], 'work', false, true)).toContain('file.tags.filter'));
	it('returns false for invalid tag input', () => expect(basesFilter(['topics'], 'a b')).toBe('false'));
	it('returns false for no properties', () => expect(basesFilter([], 'work')).toBe('false'));
});
