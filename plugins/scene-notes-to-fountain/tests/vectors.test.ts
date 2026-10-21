import { describe, expect, it } from 'vitest';
import vectors from './vectors/scene-notes-to-fountain.json';
import { buildPlan, cleanFileName, firstPlainParagraph, freePath, move, sourcesUnchanged, type Mapping, type NoteInput } from '../src/fountain';

interface Case {
	name: string;
	function: string;
	args: unknown[];
	expected: unknown;
}

function run(c: Case): unknown {
	const a = c.args;
	switch (c.function) {
		case 'buildPlan': {
			const p = buildPlan(a[0] as NoteInput[], a[1] as Mapping | undefined);
			return { text: p.text, errors: p.errors };
		}
		case 'move':
			return move(a[0] as string[], a[1] as number, a[2] as -1 | 1);
		case 'freePath': {
			const taken = new Set(a[2] as string[]);
			return freePath(a[0] as string, a[1] as string, (p) => taken.has(p));
		}
		case 'sourcesUnchanged':
			return sourcesUnchanged(a[0] as Record<string, string>, a[1] as Record<string, string>);
		case 'firstPlainParagraph':
			return firstPlainParagraph(a[0] as string);
		case 'cleanFileName':
			return cleanFileName(a[0] as string);
		default:
			throw new Error(`Unknown function ${c.function}`);
	}
}

describe('golden vectors (packages/spec/vectors/scene-notes-to-fountain.json)', () => {
	const cases = vectors.cases as Case[];
	it('has at least 20 cases', () => {
		expect(cases.length).toBeGreaterThanOrEqual(20);
	});
	for (const c of cases) {
		it(c.name, () => {
			expect(run(c)).toEqual(c.expected);
		});
	}
});
