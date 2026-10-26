import { describe, expect, it } from 'vitest';
import { planImport } from '../src/importer';
const opts={source:'Wiki',destination:'Notes'};
describe('review defects',()=>{
 it('keeps the body of a code block with a language option unchanged',()=>{
  const plan=planImport([{path:'Wiki/page.wiki',text:'{{{python\n# comment\n= x =\n}}}'}],opts);
  expect(plan.pages[0]!.markdown).toBe('```python\n# comment\n= x =\n```');
 });
 it('warns when a code block option is not a plain language name',()=>{
  const plan=planImport([{path:'Wiki/page.wiki',text:'{{{class="brush: js"\n* a\n}}}'}],opts);
  expect(plan.pages[0]!.markdown).toBe('```\n* a\n```');
  expect(plan.issues.map(i=>i.reason)).toEqual(['Code block option dropped; review it.']);
 });
 it('does not link to a different note when a page is skipped as a duplicate',()=>{
  const plan=planImport([
   {path:'Wiki/diary/2026-10-14.wiki',text:'A'},
   {path:'Wiki/diary/old/2026-10-14.wiki',text:'B'},
   {path:'Wiki/index.wiki',text:'[[diary/old/2026-10-14]]'},
  ],{...opts,diary:'Daily'});
  const index=plan.pages.find(p=>p.path==='Wiki/index.wiki')!;
  expect(index.markdown).toBe('[[diary/old/2026-10-14]]');
 });
 it('treats outputs that differ only in case as duplicates',()=>{
  const plan=planImport([{path:'Wiki/A.wiki',text:'A'},{path:'Wiki/a.wiki',text:'a'}],opts);
  expect(plan.pages.length).toBe(1);
  expect(plan.issues.map(i=>i.reason)).toEqual(['Duplicate output path; page skipped.']);
 });
 it('skips one page with an unsupported file name and imports the rest',()=>{
  const plan=planImport([{path:'Wiki/C#.wiki',text:'C'},{path:'Wiki/b.wiki',text:'B'}],opts);
  expect(plan.pages.map(p=>p.output)).toEqual(['Notes/b.md']);
  expect(plan.issues).toEqual([{source:'Wiki/C#.wiki',target:'Wiki/C#.wiki',reason:'Unsupported file name; page skipped.'}]);
 });
 it('links to the mapped diary path',()=>{
  const plan=planImport([{path:'Wiki/diary/2026-10-14.wiki',text:'Day'},{path:'Wiki/index.wiki',text:'[[diary/2026-10-14|Today]]'}],{...opts,diary:'Daily'});
  expect(plan.pages.find(p=>p.path==='Wiki/index.wiki')!.markdown).toBe('[[Daily/2026-10-14|Today]]');
 });
 it('keeps a Vimwiki absolute file link unchanged',()=>{
  const plan=planImport([{path:'Wiki/page.wiki',text:'[[//b]]'},{path:'Wiki/b.wiki',text:'B'}],opts);
  expect(plan.pages.find(p=>p.path==='Wiki/page.wiki')!.markdown).toBe('[[//b]]');
 });
});
