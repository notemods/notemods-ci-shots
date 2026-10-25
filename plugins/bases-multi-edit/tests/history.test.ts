import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import BasesMultiEditPlugin from '../src/main';
import type { Action } from '../src/edit';
import { bindPro } from '../src/pro';
const a:Action={property:'status',operation:'set',type:'text',input:'done'};
function plugin() {
 // Strict mocks return a proxy; invoke the real methods explicitly against a minimal host.
 const host={app:App.createConfigured__({files:{}}),settings:{actions:[]},history:[],busy:false,saveData:vi.fn(async()=>undefined),store:()=>({update:async(_path:string,callback:(data:Record<string,unknown>)=>void)=>callback({status:'todo'})})};
 return Object.assign(Object.create(BasesMultiEditPlugin.prototype),host) as BasesMultiEditPlugin;
}
beforeEach(()=>bindPro(null));
describe('free and Pro convenience boundaries',()=> {
 it('free can apply core edits and keeps the last batch',async()=>{const p=plugin();for(let i=0;i<3;i++) await p.apply(a,[{path:`${i}.md`,before:{exists:true,value:'todo'},after:{exists:true,value:'done'}}]);expect(p.history).toHaveLength(1);expect(p.history[0]!.changes[0]!.path).toBe('2.md');});
 it('free cannot save actions',async()=>{const p=plugin();await expect(p.saveAction(a)).rejects.toThrow('Pro');expect(p.saveData).not.toHaveBeenCalled();});
 it('Pro saves definitions without row paths',async()=>{bindPro({isPro:()=>true} as never);const p=plugin();await p.saveAction(a);await p.saveAction(a);expect(p.settings.actions).toEqual([a]);expect(p.saveData).toHaveBeenCalled();});
 it('Pro retains at most 20 batches',async()=>{bindPro({isPro:()=>true} as never);const p=plugin();for(let i=0;i<23;i++)await p.apply(a,[{path:`${i}.md`,before:{exists:true,value:'todo'},after:{exists:true,value:'done'}}]);expect(p.history).toHaveLength(20);});
 it('does not create undo history for a failed batch',async()=>{const p=plugin();p.store=()=>({update:async()=>{throw new Error('missing')}});await p.apply(a,[{path:'a',before:{exists:false},after:{exists:true,value:'done'}}]);expect(p.history).toEqual([]);});
 it('undo keeps only conflicted entries for a retry',async()=>{const p=plugin();const files:Record<string,Record<string,unknown>>={a:{status:'done',owner:'new'},b:{status:'later'}};p.store=()=>({update:async(path,callback)=>callback(files[path]!)});p.history=[{property:'status',changes:['a','b'].map(path=>({path,before:{exists:true,value:'todo'},after:{exists:true,value:'done'}}))}];await p.undo();expect(files.a).toEqual({status:'todo',owner:'new'});expect(p.history[0]!.changes.map(c=>c.path)).toEqual(['b']);});
 it('prevents overlapping edits' ,async()=>{const p=plugin();p.busy=true;await expect(p.apply(a,[])).rejects.toThrow('running');});
});

describe('view lifecycle',()=>{
 it('reopens an old Bases instance through public view state',async()=>{
  const root=document.createElement('div');root.className='bme-table-view';root.dataset.bmeGeneration='old';
  const container=document.createElement('div');container.append(root);
  const state={type:'bases',state:{file:'Review.base'}};
  const leaf={view:{containerEl:container},getViewState:()=>state,setViewState:vi.fn(async()=>undefined)};
  await BasesMultiEditPlugin.prototype.reopenStaleViews.call({generation:'new',app:{'workspace':{getLeavesOfType:()=>[leaf]}}} as never);
  expect(leaf.setViewState.mock.calls).toEqual([[{type:'empty'}],[state]]);
 });
 it('keeps the current instance open',async()=>{
  const container=document.createElement('div');const root=container.createDiv({cls:'bme-table-view'});root.dataset.bmeGeneration='new';
  const leaf={view:{containerEl:container},setViewState:vi.fn()};
  await BasesMultiEditPlugin.prototype.reopenStaleViews.call({generation:'new',app:{'workspace':{getLeavesOfType:()=>[leaf]}}} as never);
  expect(leaf.setViewState).not.toHaveBeenCalled();
 });
});
