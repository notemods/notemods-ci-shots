import { describe, expect, it } from 'vitest';
import vectors from './vectors/property-change-ledger.json';
import { runScenario, type ScenarioEvent, type Watch } from '../src/ledger';
describe('golden acceptance vectors', () => {
	it('has at least 20 cases', () => expect(vectors.cases.length).toBeGreaterThanOrEqual(20));
	for (const c of vectors.cases) it(c.name, () => {
		const [events, watch] = c.args as [ScenarioEvent[], Watch | undefined];
		expect(runScenario(events, watch)).toEqual(c.expected);
	});
});
