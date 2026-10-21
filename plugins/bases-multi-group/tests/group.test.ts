import { describe, expect, it } from 'vitest';
import { buildGroups, effectiveProperties, summarize, type GroupOptions, type Row } from '../src/group';
import vectors from './vectors/bases-multi-group.json';
const row = (id: string, values: Row['values']): Row => ({ id, values });
const opts = (extra: Partial<GroupOptions> = {}): GroupOptions => ({ properties: ['status', 'project'], splitLists: false, pro: false, ...extra });

describe('golden acceptance cases', () => {
	for (const c of vectors.cases) it(c.name, () => expect(buildGroups(...c.args as [Row[], GroupOptions])).toEqual(c.expected));
});
describe('group edge cases', () => {
	it('empty input has no groups', () => expect(buildGroups([], opts())).toEqual([]));
	it('no properties has no groups', () => expect(buildGroups([row('a', {})], opts({ properties: [] }))).toEqual([]));
	it('free permits two distinct properties', () => expect(effectiveProperties(['a', 'a', 'b', 'c'], false)).toEqual(['a', 'b']));
	it('pro permits three distinct properties', () => expect(effectiveProperties([' a ', '', 'b', 'c', 'd'], true)).toEqual(['a', 'b', 'c']));
	it('repeated input paths count once', () => expect(buildGroups([row('a', { status: 'x' }), row('a', { status: 'x' })], opts())[0]?.count).toBe(1));
	it('zero has a group', () => expect(buildGroups([row('a', { status: 0 })], opts())[0]?.label).toBe('0'));
	it('false has a group', () => expect(buildGroups([row('a', { status: false })], opts())[0]?.label).toBe('false'));
	it('number and string are separate', () => expect(buildGroups([row('a', { status: 1 }), row('b', { status: '1' })], opts())).toHaveLength(2));
	it('case is significant', () => expect(buildGroups([row('a', { status: 'Todo' }), row('b', { status: 'todo' })], opts())).toHaveLength(2));
	it('whitespace is significant', () => expect(buildGroups([row('a', { status: 'Todo' }), row('b', { status: ' Todo ' })], opts())).toHaveLength(2));
	it('literal no-value label does not merge with missing', () => expect(buildGroups([row('a', { status: '(no value)' }), row('b', {})], opts())).toHaveLength(2));
	it('non-finite numbers become empty', () => expect(buildGroups([row('a', { status: NaN }), row('b', { status: Infinity })], opts())[0]?.count).toBe(2));
	it('empty string and null share a group', () => expect(buildGroups([row('a', { status: '' }), row('b', { status: null })], opts())[0]?.count).toBe(2));
	it('preserves note order', () => expect(buildGroups([row('z', { status: 'x' }), row('a', { status: 'x' })], opts())[0]?.children[0]?.rows).toEqual(['z', 'a']));
	it('natural numeric group order', () => expect(buildGroups([row('a', { status: '10' }), row('b', { status: '2' })], opts()).map((g) => g.label)).toEqual(['2', '10']));
	it('parent summary counts each note once across children', () => {
		const g = buildGroups([row('a', { status: 'x', project: ['A', 'B'], hours: 4 })], opts({ splitLists: true, pro: true, summaryProperty: 'hours' }));
		expect(g[0]?.summary).toBe(4); expect(g[0]?.children).toHaveLength(2);
	});
	it('split two lists produces every pairing', () => {
		const g = buildGroups([row('a', { status: ['x', 'y'], project: ['A', 'B'] })], opts({ splitLists: true }));
		expect(g).toHaveLength(2); expect(g.every((x) => x.children.length === 2)).toBe(true);
	});
	it('typed keys do not collide on delimiters', () => {
		const g = buildGroups([row('a', { status: 'a/b', project: 'c' }), row('b', { status: 'a', project: 'b/c' })], opts());
		expect(g[0]?.children[0]?.key).not.toBe(g[1]?.children[0]?.key);
	});
	it('property names affect saved fold keys', () => {
		const r = [row('a', { status: 'x', project: 'x' })];
		expect(buildGroups(r, opts({ properties: ['status'] }))[0]?.key).not.toBe(buildGroups(r, opts({ properties: ['project'] }))[0]?.key);
	});
	it('no number gives no summary', () => expect(summarize([row('a', { n: '3' })], 'n')).toBeNull());
	it('summary includes zero and negative numbers', () => expect(summarize([row('a', { n: 0 }), row('b', { n: -4 })], 'n', 'average')).toBe(-2));
	it('summary ignores booleans, lists, numeric strings and infinity', () => expect(summarize([row('a', { n: 3 }), row('b', { n: true }), row('c', { n: [4] }), row('d', { n: '5' }), row('e', { n: Infinity })], 'n')).toBe(3));
	it('summary without property is null', () => expect(summarize([row('a', {})], undefined)).toBeNull());
});
