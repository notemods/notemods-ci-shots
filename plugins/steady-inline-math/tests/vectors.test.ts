import { describe, expect, it } from 'vitest';
import vectors from './vectors/steady-inline-math.json';
import { runScenario, type Step } from './scenario';
describe('golden acceptance vectors', () => {
	it('has at least 20 vectors', () => expect(vectors.cases.length).toBeGreaterThanOrEqual(20));
	for (const c of vectors.cases) it(c.name, () => expect(runScenario(...c.args as [string, number, Step[]])).toEqual(c.expected));
});
