import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseYaml } from 'obsidian';
import { flatten, parseNumber } from '../src/flatten';

// The sample vault in docs/sample-notes is also the end-to-end vault. These numbers are the same ones the
// end-to-end test checks in the real app.
const dir = join(__dirname, '..', 'docs', 'sample-notes', 'Projects');
const notes = readdirSync(dir)
	.sort()
	.map((f) => {
		const text = readFileSync(join(dir, f), 'utf8');
		const fm = /^---\n([\s\S]*?)\n---/.exec(text)![1]!;
		return { path: `Flatten Table/Projects/${f}`, frontmatter: parseYaml(fm) as Record<string, unknown> };
	});
const hours = (rows: { cells: string[] }[], k: number) => rows.reduce((s, r) => s + (parseNumber(r.cells[k]!) ?? 0), 0);

describe('sample vault (12 project notes)', () => {
	it('flattens 43 milestones from 11 notes; one note has none', () => {
		const r = flatten(notes, { property: 'milestones' });
		expect(notes).toHaveLength(12);
		expect(r.rows).toHaveLength(43);
		expect(r.sources).toBe(11);
		expect(r.emptyNotes).toBe(1);
		expect(r.columns).toEqual(['step', 'owner', 'due', 'status', 'hours']);
		expect(hours(r.rows, 4)).toBe(205);
	});
	it('open milestones hold 142 hours', () => {
		const r = flatten(notes, { property: 'milestones', filter: { column: 'status', op: 'not-equals', value: 'done' } });
		expect(hours(r.rows, 4)).toBe(142);
	});
	it('four owners', () => {
		expect(flatten(notes, { property: 'milestones', groupBy: 'owner' }).groups).toHaveLength(4);
	});
});
