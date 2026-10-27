import { describe, expect, it } from 'vitest';
import { applyChanges, field, transform, writeField, type Action } from '../src/edit';
import { previewChanges, FRONTMATTER_WARNING, VALUE_DESCRIPTION } from '../src/preview';
const action = (patch: Partial<Action> = {}): Action => ({ property: 'tags', operation: 'append', type: 'list', input: '["review"]', ...patch });

describe('list normalization', () => {
 it.each([null, 'project', false, 0])('appends to empty or scalar %j', value => {
  expect(transform({exists:true,value},action())).toEqual({exists:true,value:value===null ? ['review'] : [value,'review']});
 });
 it.each([null, 'review', false, 0])('removes from empty or scalar %j', value => {
  expect(transform({exists:true,value},action({operation:'remove-items',input:JSON.stringify([value])}))).toEqual({exists:true,value:[]});
 });
 it('retains a nonmatching scalar as a list', () => expect(transform({exists:true,value:'project'},action({operation:'remove-items'}))).toEqual({exists:true,value:['project']}));
 it('retains duplicate old items and appends new items only once', () => expect(transform({exists:true,value:['project','project']},action({input:'["project","review","review"]'}))).toEqual({exists:true,value:['project','project','review']}));
 it.each([{},[{}],[['nested']]])('rejects complex existing values %j',value=>expect(()=>transform({exists:true,value},action())).toThrow('existing property'));
 it('remove property ignores invalid Value input',()=>expect(transform({exists:true,value:['project']},action({operation:'remove-property',type:'number',input:'not a number'}))).toEqual({exists:false}));
 it('explains the whole-key removal in the form',()=>expect(VALUE_DESCRIPTION).toContain('Remove property ignores Value and Value type'));
});

describe('case-insensitive properties',()=>{
 it('finds a case variant',()=>expect(field({Status:'todo'},'status')).toEqual({exists:true,value:'todo'}));
 it('updates the existing spelling without adding a key',()=>{const data={Status:'todo'};writeField(data,'STATUS',{exists:true,value:'done'});expect(data).toEqual({Status:'done'});});
 it('removes a case variant',()=>{const data={Status:'todo'};writeField(data,'status',{exists:false});expect(data).toEqual({});});
 it('rejects ambiguous duplicate spellings',()=>expect(()=>field({Status:'todo',status:'other'},'status')).toThrow('Multiple property keys'));
 it('detects an intervening edit through another casing',async()=>{const data={Status:'later'};const r=await applyChanges({update:async(_,cb)=>cb(data)},[{path:'a.md',before:{exists:true,value:'todo'},after:{exists:true,value:'done'}}],'status');expect(r.skipped[0]).toContain('Property changed');expect(data.Status).toBe('later');});
 it('restores a removed key with its original spelling and value',async()=>{
  const data:Record<string,unknown>={Status:'todo',owner:'Mina'};
  const p=await previewChanges(['a.md'],action({property:'status',operation:'remove-property'}),async()=>data);
  await applyChanges({update:async(_,cb)=>cb(data)},p.changes,'status');expect(data).toEqual({owner:'Mina'});
  await applyChanges({update:async(_,cb)=>cb(data)},p.changes,'status',true);expect(data).toEqual({owner:'Mina',Status:'todo'});
 });
});

describe('preview isolates note failures',()=>{
 it('previews and applies a mixed list batch, then restores the original scalar/null values',async()=>{
  const files:Record<string,Record<string,unknown>>={empty:{tags:null},scalar:{Tags:'project'},list:{tags:['project']},absent:{}};
  const plan=await previewChanges(Object.keys(files),action(),async path=>files[path]!);
  expect(plan.changes).toHaveLength(4);expect(plan.skipped).toEqual([]);
  await applyChanges({update:async(path,cb)=>cb(files[path]!)},plan.changes,'tags');expect(files.scalar).toEqual({Tags:['project','review']});
  await applyChanges({update:async(path,cb)=>cb(files[path]!)},plan.changes,'tags',true);
  expect(files).toEqual({empty:{tags:null},scalar:{Tags:'project'},list:{tags:['project']},absent:{}});
 });
 it('names invalid notes and missing notes and continues to the good note',async()=>{
  const plan=await previewChanges(['bad.md','missing.md','good.md'],action(),async path=>{if(path==='missing.md')throw Error('Markdown note no longer exists.');return path==='bad.md'?{tags:{nested:true}}:{tags:'project'};});
  expect(plan.changes.map(c=>c.path)).toEqual(['good.md']);expect(plan.skipped).toHaveLength(2);
  expect(plan.messages[0]).toContain('bad.md: skipped:');expect(plan.messages[1]).toContain('missing.md: skipped: Markdown note no longer exists.');
 });
 it('names read and YAML parse failures',async()=>{const p=await previewChanges(['private.md'],action(),async()=>{throw Error('Invalid YAML');});expect(p.skipped).toEqual(['private.md: skipped: Invalid YAML']);});
 it('skips ambiguous case variants without blocking other notes',async()=>{const p=await previewChanges(['bad','good'],action(),async path=>path==='bad'?{tags:[],Tags:['a']}:{tags:[]});expect(p.skipped[0]).toContain('bad: skipped: Multiple property keys');expect(p.changes[0]?.path).toBe('good');});
 it('invalid action input fails before reading any note',async()=>{let reads=0;await expect(previewChanges(['a'],action({input:'bad JSON'}),async()=>{reads++;return {};})).rejects.toThrow('JSON list');expect(reads).toBe(0);});
 it('keeps unchanged notes out of the apply count',async()=>{const p=await previewChanges(['a'],action(),async()=>({tags:['review']}));expect(p.changes).toEqual([]);expect(p.messages[0]).toContain('(unchanged)');});
 it('discloses YAML formatting and value-only undo',()=>{expect(FRONTMATTER_WARNING).toContain('re-serialize frontmatter');expect(FRONTMATTER_WARNING).toContain('YAML comments');expect(FRONTMATTER_WARNING).toContain('Undo restores property values');});
});
