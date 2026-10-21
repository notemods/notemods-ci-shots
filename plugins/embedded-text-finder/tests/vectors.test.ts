import { describe, expect, it } from 'vitest';
import vectors from './vectors/embedded-text-finder.json';
import { parseDocument, search, type SearchStore } from '../src/search';

interface Fixture { notes: Record<string, string>; folder: string; query: string; note?: string; regions?: Record<string, number[]>; updates?: Record<string, string> }
function store(fixture: Fixture): SearchStore {
 return {
  paths: () => Object.keys(fixture.notes),
  read: async (path) => parseDocument(fixture.notes[path]!),
  resolve: (link, from) => {
   const hash = link.indexOf('#');
   const target = hash < 0 ? link : link.slice(0, hash);
   const subpath = hash < 0 ? '' : link.slice(hash);
   const path = target ? (target.endsWith('.md') ? target : target + '.md') : from;
   return path in fixture.notes ? { path, subpath } : null;
  },
  region: async (path, subpath) => {
   const r = fixture.regions?.[path + subpath];
   return r ? { start: r[0]!, end: r[1]! } : null;
  },
 };
}
describe('golden vectors', () => {
 for (const c of vectors.cases) it(c.name, async () => {
  const fixture = structuredClone(c.args[0]) as Fixture;
  const adapter = store(fixture);
  if (fixture.updates) {
   const first = await search(adapter, fixture);
   expect(first.matches).toHaveLength(0);
   Object.assign(fixture.notes, fixture.updates);
  }
  const result = await search(adapter, fixture);
  expect({matches:result.matches.map(m => [m.container,m.source,m.subpath,m.depth]), reports:result.diagnostics.map(d => d.reason)}).toEqual(c.expected);
  for (const m of result.matches) expect(m.excerpt).toContain(fixture.query);
 });
});

it('permits cancellation between batches', async () => {
 const fixture: Fixture = { notes: Object.fromEntries(Array.from({length:60},(_,i)=>[`Parents/${i}.md`,'blue bird'])),folder:'Parents',query:'blue bird' };
 let cancelled = false;
 const result = await search(store(fixture), {...fixture, cancelled:()=>cancelled, yield:async()=>{cancelled=true;}});
 expect(result.cancelled).toBe(true);
 expect(result.scanned).toBeLessThan(60);
 expect(result.matches.length).toBeGreaterThan(0);
});
it('reports read failure and continues to another container', async () => {
 const fixture: Fixture = {notes:{'Parents/A.md':'blue bird','Parents/B.md':'blue bird'},folder:'Parents',query:'blue bird'};
 const adapter = store(fixture);
 adapter.read = async(path)=>{if(path.endsWith('/A.md')) throw new Error('gone');return parseDocument('blue bird');};
 const result = await search(adapter,fixture);
 expect(result.matches.map(m=>m.container)).toEqual(['Parents/B.md']);
 expect(result.diagnostics[0]?.reason).toBe('Read failed');
});
