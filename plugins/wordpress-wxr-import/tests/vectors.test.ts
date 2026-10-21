import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { planImport, markdown, type Profile, type Snapshot } from '../src/model';
import vectors from './fixtures/vectors.json';
interface Input { xml: string; folder: string; mapping: Profile['mapping']; baseline: Snapshot | null; existing: boolean }
function result(input: Input): unknown {
 try {
  const p = planImport(input.xml, input.folder, input.mapping, input.baseline ?? undefined);
  if (input.existing) throw new Error('The destination folder exists. Choose a new folder.');
  return { posts: p.parsed.posts, pages: p.parsed.pages, names: p.files.filter((f) => f.path.endsWith('.md') && !f.path.split('/').pop()!.startsWith('_')).map((f) => f.path.split('/').pop()), approved: p.parsed.records.reduce((n, r) => n + r.comments.length, 0), omitted: p.parsed.omittedComments, shortcodes: p.parsed.shortcodes, skipped: p.parsed.skipped, bodies: p.parsed.records.map((r) => markdown(r.html)), changes: p.changes };
 } catch (e) { return { error: (e as Error).message }; }
}
describe('golden acceptance vectors', () => {
 for (const c of vectors.cases) it(c.name, () => expect(result(c.args[0] as Input)).toEqual(c.expected));
 const path = '../../packages/spec/vectors/wordpress-wxr-import.json';
 it.skipIf(!existsSync(path))('keeps the export copy equal to the factory vectors', () => expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(vectors));
});
