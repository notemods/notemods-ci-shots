import { describe, expect, it } from 'vitest';
import vectors from './vectors/table-row-links.json';
import * as rows from '../src/rows';
import type { RowAnchorResult } from '../src/rows';

interface Case {
	name: string;
	function?: string;
	args: unknown[];
	expected: unknown;
	deterministic_id?: string;
}

/** Joins the first argument when the target function takes one text string and the vector holds lines. */
const TEXT_FUNCS = new Set(['markedRows']);

function call(c: Case): unknown {
	const fn = rows[c.function as keyof typeof rows] as unknown as (...a: unknown[]) => unknown;
	if (c.function === 'removeUnusedAnchors') return rows.removeUnusedAnchors(c.args[0] as string, new Set(c.args[1] as string[]));
	if (TEXT_FUNCS.has(c.function ?? '')) {
		return fn((c.args as string[]).join('\n'));
	}
	return fn(...c.args);
}

describe('golden vectors (packages/spec/vectors/table-row-links.json)', () => {
	const cases = vectors.cases as Case[];
	it('has at least 20 cases in all', () => {
		expect(cases.length).toBeGreaterThanOrEqual(20);
	});
	for (const c of cases) {
		it(c.name, () => {
			if (c.function) {
				expect(call(c)).toEqual(c.expected);
				return;
			}
			const [lines, index, vault, path] = c.args as [string[], number, string, string];
			const want = c.expected as RowAnchorResult;
			if (c.deterministic_id) {
				expect(rows.rowAnchor(lines.slice(), index, vault, path, c.deterministic_id)).toEqual(want);
				return;
			}
			const seeded = lines.slice();
			const got = rows.rowAnchor(seeded, index, vault, path);
			if (!want.available) {
				expect(got).toEqual(want);
				return;
			}
			expect(got.id).toMatch(/^[a-z0-9]{6}$/);
			expect(got.changed).toBe(want.changed);
			expect(got.label).toBe(want.label);
			expect(got.rowIndex).toBe(want.rowIndex);
			if (want.id) expect(got.link.replace(got.id, want.id)).toBe(want.link);
			if (want.line) expect(got.line.replace(got.id, want.id)).toBe(want.line);
		});
	}
});
