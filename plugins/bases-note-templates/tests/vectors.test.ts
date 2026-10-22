import { describe, expect, it } from 'vitest';
import vectors from './vectors/bases-note-templates.json';
import { planNewNote, type PlanInput, type Props } from '../src/template';

describe('golden vectors (packages/spec/vectors/bases-note-templates.json)', () => {
	for (const c of vectors.cases) {
		it(c.name, () => {
			const [input, props] = c.args as [PlanInput, Props];
			expect(planNewNote(input, props)).toEqual(c.expected);
		});
	}
	it('covers each area of the filter rules and the name pattern', () => {
		const names = vectors.cases.map((c) => c.name).join('\n');
		for (const w of ['equality', 'hasTag', 'types.json', 'or and not', 'negated', 'comparison', 'file.folder', 'folder setting', 'template variables', 'unsafe characters', 'link()', '!isEmpty', 'containsAll', 'columns', 'blank column', 'tags from the template', 'this references']) expect(names).toContain(w);
	});
});
