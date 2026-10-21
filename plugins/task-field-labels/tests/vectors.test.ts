import { describe, it, expect } from 'vitest';
import data from './vectors/task-field-labels.json';
import { runScenario, type Scenario } from './scenarios';
const vectors = data as { cases: { name: string; args: [Scenario]; expected: unknown }[] };
describe('golden acceptance cases', () => { for (const c of vectors.cases) it(c.name, async () => expect(await runScenario(...c.args)).toEqual(c.expected)); });
