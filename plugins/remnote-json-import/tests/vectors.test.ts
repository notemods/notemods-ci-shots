import { describe, expect, it } from 'vitest';
import vectors from './vectors/remnote-json-import.json';
import { planImport, type Layout } from '../src/importer';
interface Case { name: string; args: [string, Layout]; expected: Record<string, unknown> }
describe('golden acceptance vectors', () => {
 it('has at least 20 cases', () => expect(vectors.cases.length).toBeGreaterThanOrEqual(20));
 for (const c of vectors.cases as Case[]) it(c.name, () => {
  if (c.expected.error) { expect(() => planImport(...c.args)).toThrow(String(c.expected.error)); return; }
  const plan = planImport(...c.args);
  const bodies = plan.notes.map(n => n.content.replace(/^---\n[\s\S]*?---\n\n/, ''));
  const got: Record<string, unknown> = { paths: plan.notes.map(n => n.path), bodies, count: plan.count, warningTypes: plan.warnings.map(w => w.type), noteIds: plan.notes.map(n => n.ids), bodiesTail: bodies[bodies.length - 1] };
  expect(Object.fromEntries(Object.keys(c.expected).map(k => [k, got[k]]))).toEqual(c.expected);
 });
});
