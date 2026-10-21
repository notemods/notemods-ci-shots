import { describe, expect, it } from 'vitest';
import vectors from './vectors/vimwiki-import.json';
import { planImport, assessPage, type Options, type Source } from '../src/importer';
describe('golden acceptance vectors', () => {
 it('has at least twenty vectors',()=>expect(vectors.cases.length).toBeGreaterThanOrEqual(20));
 for(const c of vectors.cases) it(c.name,()=>{
  const fn='function' in c ? c.function : 'planImport';
  const result=fn==='assessPage' ? assessPage(...c.args as [string,string|null,boolean,boolean?]) : planImport(...c.args as [Source[],Options]);
  expect(result).toEqual(c.expected);
 });
});
