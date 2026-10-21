import { describe, expect, it } from 'vitest';
import vectors from './vectors/kanban-embed.json';
import { applyEdit, type EditOp } from '../src/board';

describe('golden vectors (packages/spec/vectors/kanban-embed.json)', () => {
	it('has at least 20 cases', () => {
		expect(vectors.cases.length).toBeGreaterThanOrEqual(20);
	});
	for (const c of vectors.cases) {
		it(c.name, () => {
			const [md, op] = c.args as [string, EditOp];
			expect(applyEdit(md, op)).toEqual(c.expected);
		});
	}
});
