import { beforeAll, describe, expect, it, vi } from 'vitest';
// The mock library has no BasesView runtime class; supply only the public base class for pure selection tests.
vi.mock('obsidian', async importOriginal => { const original=await importOriginal<Record<string,unknown>>(); return {...original,BasesView:class {}}; });
let prune: typeof import('../src/view').pruneSelection;
beforeAll(async()=> { prune=(await import('../src/view')).pruneSelection; });
describe('query-scoped temporary selection',()=> {
 it('drops hidden paths',()=> {const selected=new Set(['a.md','b.md']);prune(selected,['b.md']);expect([...selected]).toEqual(['b.md']);});
 it('clears selection when the query is empty',()=> {const selected=new Set(['a.md']);prune(selected,[]);expect(selected.size).toBe(0);});
 it('does not select new query rows',()=> {const selected=new Set(['a.md']);prune(selected,['a.md','b.md']);expect([...selected]).toEqual(['a.md']);});
});
