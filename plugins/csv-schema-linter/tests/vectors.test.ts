import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vectors from './vectors.json';
import { check, checkSize, markdownReport } from '../src/checker';
describe('golden vectors', () => {
 it('has at least 20 cases', () => expect(vectors.cases.length).toBeGreaterThanOrEqual(20));
 const shared = resolve(process.cwd(), '../../packages/spec/vectors/csv-schema-linter.json');
 it.skipIf(!existsSync(shared))('keeps the export copy equal to the factory vectors', () => expect(JSON.parse(readFileSync(shared, 'utf8'))).toEqual(vectors));
 for (const c of vectors.cases) it(c.name, () => {
  const args = c.args as unknown[];
  if ('operation' in c) {
   const csv = args[0] as string; const schema = args[1] as string; const before = csv;
   const one = check(csv, schema); const two = check(csv, schema);
   expect({ sameSource: csv === before, sameResult: JSON.stringify(one) === JSON.stringify(two), report: markdownReport('source.csv', one) }).toEqual(c.expected); return;
  }
  const run = () => 'function' in c ? checkSize('x'.repeat(args[2] as number), args[1] as string) : check(args[0] as string, args[1] as string);
  if ('error' in c.expected) expect(run).toThrow(c.expected.error); else expect(run()).toEqual(c.expected);
 });
});
