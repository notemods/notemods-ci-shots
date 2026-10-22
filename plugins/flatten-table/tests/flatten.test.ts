import { describe, expect, it } from 'vitest';
import { flatten, itemCells, itemsOf, parseNumber, readPath, scalarText, toCsv, toMarkdown } from '../src/flatten';
import { propertyName } from '../src/view';

describe('helpers', () => {
	it('reads a property path, whole key first, then split, without case', () => {
		expect(readPath({ A: { b: [1] } }, 'a.B')).toEqual([1]);
		expect(readPath({ 'a.b': 2, a: { b: 3 } }, 'a.b')).toBe(2);
		expect(readPath(null, 'x')).toBeUndefined();
		expect(readPath({ a: 1 }, 'a.b')).toBeUndefined();
	});

	it('turns values into cell text', () => {
		expect(scalarText(null)).toBe('');
		expect(scalarText(3)).toBe('3');
		expect(scalarText(false)).toBe('false');
		expect(scalarText(new Date('2026-10-10T00:00:00Z'))).toBe('2026-10-10');
		expect(scalarText(['a', { b: 1 }])).toBe('a, {"b":1}');
	});

	it('items: a list, one value, or nothing', () => {
		expect(itemsOf(['a', null, 'b'])).toEqual(['a', 'b']);
		expect(itemsOf('x')).toEqual(['x']);
		expect(itemsOf('')).toEqual([]);
		expect(itemsOf(undefined)).toEqual([]);
	});

	it('stops at a depth of 4 and writes deeper objects as JSON', () => {
		const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } };
		expect(itemCells(deep)).toEqual([['a.b.c.d.e', '{"f":1}']]);
	});

	it('parses numbers with signs and separators', () => {
		expect(parseNumber('$1,200.50')).toBe(1200.5);
		expect(parseNumber('12 %')).toBe(12);
		expect(parseNumber('\u22123')).toBe(-3);
		expect(parseNumber('2026-10-10')).toBeNull();
		expect(parseNumber('')).toBeNull();
	});

	it('property names from the picker lose the note. prefix', () => {
		expect(propertyName('note.milestones')).toBe('milestones');
		expect(propertyName(' roles ')).toBe('roles');
		expect(propertyName(5)).toBe('');
	});
});

describe('export', () => {
	const r = flatten([{ path: 'Folder/A b.md', frontmatter: { x: [{ t: 'a|b', n: 'x, "y"' }] } }], { property: 'x' });
	it('Markdown escapes pipes and links the source note', () => {
		expect(toMarkdown(r)).toBe('| Source | t | n |\n| --- | --- | --- |\n| [[Folder/A b\\|A b]] | a\\|b | x, "y" |\n');
		expect(toMarkdown(r, false)).toBe('| t | n |\n| --- | --- |\n| a\\|b | x, "y" |\n');
	});
	it('CSV quotes fields with commas and quotes', () => {
		expect(toCsv(r)).toBe('Source,t,n\r\nFolder/A b.md,a|b,"x, ""y"""\r\n');
	});
});

describe('scale', () => {
	it('flattens 2,000 notes with 5 items each, sorted, inside a tolerant budget', () => {
		const notes = Array.from({ length: 2000 }, (_, i) => ({
			path: `P/${i}.md`,
			frontmatter: { m: Array.from({ length: 5 }, (_, j) => ({ step: `S${j}`, hours: (i * 7 + j) % 13, due: `2026-${String(1 + (j % 12)).padStart(2, '0')}-01` })) },
		}));
		const t0 = performance.now();
		const r = flatten(notes, { property: 'm', sort: { column: 'hours', dir: 'desc' }, filter: { column: 'step', op: 'not-equals', value: 'S0' } });
		const ms = performance.now() - t0;
		expect(r.rows).toHaveLength(8000);
		expect(r.rows[0]!.cells[1]).toBe('12');
		// Strict budget only under FX_PERF_STRICT=1; the default ceiling tolerates a busy machine.
		expect(ms).toBeLessThan(process.env.FX_PERF_STRICT === '1' ? 150 : 2000);
	});
});
