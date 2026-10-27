import { describe, expect, it } from 'vitest';
import { applyChanges, equal, field, inputValue, transform, writeField, type Action, type Change } from '../src/edit';
import { normalizeSettings } from '../src/settings';
import vectors from './vectors/bases-multi-edit.json';
const action = (patch: Partial<Action> = {}): Action => ({ property: 'status', operation: 'set', type: 'text', input: 'done', ...patch });
describe('golden property edits', () => {
 for (const c of vectors.cases) it(c.name, () => expect(transform(c.args[0] as never, c.args[1] as never)).toEqual(c.expected));
});
describe('validation and property semantics', () => {
 it.each(['', '__proto__', 'constructor', 'prototype', 'file.name', 'a:b', ' a', 'a\nb'])('rejects unsafe property %j', property => expect(() => transform({exists:false}, action({property}))).toThrow());
 it.each(['', 'NaN', 'Infinity', '1x', '0x10', '0b11', ' 5 ', '.5', '5.'])('rejects number %j', input => expect(() => inputValue(action({type:'number',input}))).toThrow());
 it('preserves zero', () => expect(inputValue(action({type:'number',input:'0'}))).toBe(0));
 it('preserves false', () => expect(inputValue(action({type:'checkbox',input:'false'}))).toBe(false));
 it('rejects checkbox spelling', () => expect(() => inputValue(action({type:'checkbox',input:'False'}))).toThrow());
 it.each(['{}','[{}]','[[]]','bad'])('rejects invalid list %j', input => expect(() => inputValue(action({type:'list',input}))).toThrow());
 it('wraps an existing scalar for append', () => expect(transform({exists:true,value:'old'},action({operation:'append',type:'list',input:'["a"]'}))).toEqual({exists:true,value:['old','a']}));
 it('rejects appending a scalar input', () => expect(() => transform({exists:false},action({operation:'append'}))).toThrow());
 it('distinguishes absent from null', () => expect(equal({exists:false},{exists:true,value:null})).toBe(false));
 it('ignores inherited keys', () => expect(field(Object.create({status:'done'}),'status')).toEqual({exists:false}));
 it('snapshots arrays independently', () => { const data={tags:['a']}; const snapshot=field(data,'tags'); data.tags.push('b'); expect(snapshot.value).toEqual(['a']); });
 it('writes only the chosen key', () => { const data={status:'todo',title:'Keep'}; writeField(data,'status',{exists:false}); expect(data).toEqual({title:'Keep'}); });
 it('repairs saved settings', () => expect(normalizeSettings({actions:[null,{},action(),action({property:'__proto__'})]})).toEqual({actions:[action()]}));
});
describe('atomic batch and undo', () => {
 const change = (path:string):Change => ({path,before:{exists:true,value:'todo'},after:{exists:true,value:'done'}});
 it('changes only selected files', async () => { const files:Record<string,Record<string,unknown>>={a:{status:'todo'},b:{status:'todo'},c:{status:'todo'}}; const r=await applyChanges({update:async(p,cb)=>cb(files[p]!)},[change('a'),change('b')],'status'); expect(r.completed).toHaveLength(2); expect(files.c!.status).toBe('todo'); });
 it('skips a conflict and continues', async () => { const files:Record<string,Record<string,unknown>>={a:{status:'changed'},b:{status:'todo'}}; const r=await applyChanges({update:async(p,cb)=>cb(files[p]!)},[change('a'),change('b')],'status'); expect(r.skipped).toHaveLength(1); expect(files.a!.status).toBe('changed'); expect(files.b!.status).toBe('done'); });
 it('reports failed writes without claiming completion', async () => { const r=await applyChanges({update:async()=>{throw new Error('disk')}},[change('a')],'status');expect(r.completed).toEqual([]);expect(r.skipped[0]).toContain('disk'); });
 it('undo retains unrelated changes', async () => { const data={status:'done',body:'new'}; await applyChanges({update:async(_,cb)=>cb(data)},[change('a')],'status',true);expect(data).toEqual({status:'todo',body:'new'}); });
 it('undo skips newer property changes', async () => { const data={status:'later'}; const r=await applyChanges({update:async(_,cb)=>cb(data)},[change('a')],'status',true);expect(r.skipped).toHaveLength(1);expect(data.status).toBe('later'); });
 it('undo restores absence', async () => { const data:Record<string,unknown>={status:'done'}; await applyChanges({update:async(_,cb)=>cb(data)},[{path:'a',before:{exists:false},after:{exists:true,value:'done'}}],'status',true);expect(data).toEqual({}); });
 it('undo restores a removed list', async () => { const data={}; await applyChanges({update:async(_,cb)=>cb(data)},[{path:'a',before:{exists:true,value:['a']},after:{exists:false}}],'tags',true);expect(data).toEqual({tags:['a']}); });
});
