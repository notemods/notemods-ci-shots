import { describe, expect, it } from 'vitest';
import vectors from './vectors/flatten-table.json';
import { flatten, type FlattenOptions, type SourceNote } from '../src/flatten';

interface Expected {
	valueColumn?: string;
	columns?: string[];
	rows?: (string | number)[][];
	sources?: number;
	skippedSources?: number;
	emptyNotes?: number;
	groups?: { key: string; count: number }[] | null;
}

describe('golden vectors (packages/spec/vectors/flatten-table.json)', () => {
	it('has at least 20 cases', () => {
		expect(vectors.cases.length).toBeGreaterThanOrEqual(20);
	});
	for (const c of vectors.cases) {
		it(c.name, () => {
			const [notes, opts] = c.args as unknown as [SourceNote[], FlattenOptions];
			const r = flatten(notes, opts);
			const got: Expected = {
				valueColumn: r.valueColumn,
				columns: r.columns,
				rows: r.rows.map((x) => [x.source, x.index, ...x.cells]),
				sources: r.sources,
				skippedSources: r.skippedSources,
				emptyNotes: r.emptyNotes,
				groups: r.groups?.map((g) => ({ key: g.key, count: g.rows.length })) ?? null,
			};
			const want = c.expected as Expected;
			const picked = Object.fromEntries(Object.keys(want).map((k) => [k, got[k as keyof Expected]]));
			expect(picked).toEqual(want);
		});
	}
});
