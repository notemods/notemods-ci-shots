import { describe, expect, it } from 'vitest';
import vectors from './vectors/table-rollup.json';
import { rollup, type RollupOptions, type SourceNote } from '../src/table';

interface Expected {
	columns?: string[];
	align?: (string | null)[];
	rows?: string[][];
	sources?: number;
	skippedSources?: number;
	summary?: (string | null)[] | null;
	groups?: { key: string; count: number; summary: (string | null)[] | null }[];
}

describe('golden vectors (packages/spec/vectors/table-rollup.json)', () => {
	it('has at least 20 cases', () => {
		expect(vectors.cases.length).toBeGreaterThanOrEqual(20);
	});
	for (const c of vectors.cases) {
		it(c.name, () => {
			const [notes, opts] = c.args as [SourceNote[], RollupOptions];
			const r = rollup(notes, opts);
			const got: Expected = {
				columns: r.columns,
				align: r.align,
				rows: r.rows.map((x) => [x.source, ...x.cells]),
				sources: r.sources,
				skippedSources: r.skippedSources,
				summary: r.summary,
				groups: r.groups?.map((g) => ({ key: g.key, count: g.rows.length, summary: g.summary })),
			};
			const want = c.expected as Expected;
			const picked = Object.fromEntries(Object.keys(want).map((k) => [k, got[k as keyof Expected]]));
			expect(picked).toEqual(want);
		});
	}
});
