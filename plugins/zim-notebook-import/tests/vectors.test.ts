import { describe, it, expect } from 'vitest';
import vectors from './vectors/zim-notebook-import.json';
import { planZimImport, type ZimSource, type ZimRules } from '../src/core/index';
describe('Zim golden vectors', () => {
	it('covers at least 20 cases', () => expect(vectors.cases.length).toBeGreaterThanOrEqual(20));
	for (const c of vectors.cases) it(c.name, () => {
		const [sources, source, destination, existing, rules] = c.args as [ZimSource[], string, string, string[], ZimRules | undefined];
		expect(planZimImport(sources, source, destination, existing, rules)).toEqual(c.expected);
	});
});
