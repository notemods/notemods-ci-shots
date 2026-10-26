import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import Finder from '../src/main';
import manifest from '../manifest.json';
import { bindPro, isPro, onProChange, resetPro, SPONSORS } from '../src/pro';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import { DocumentIndex, exportResults, parseDocument } from '../src/search';

afterEach(resetPro);
function manager(enabled:boolean) { const callbacks=new Set<()=>void>();return {isPro:()=>enabled,onChange:(fn:()=>void)=>{callbacks.add(fn);return()=>callbacks.delete(fn);},set:(v:boolean)=>{enabled=v;for(const fn of callbacks) fn();}}; }
function plugin(){const app=App.createConfigured__({files:{'Source.md':'blue bird'}});return new Finder(app as never,manifest as never);}
describe('Pro guards',()=>{
 it('keeps saved searches, index and export off without Pro',async()=>{
  const p=plugin(); const create=vi.spyOn(p.app.vault,'create');
  expect(await p.savePreset('Review','','blue bird')).toBe(false);
  expect(await p.setIndex(true)).toBe(false);
  expect(await p.removePreset('Review')).toBe(false);
  expect(await p.export({matches:[],diagnostics:[],scanned:0,cancelled:false},'bird')).toBeNull();
  expect(p.settings.presets).toEqual([]);expect(p.settings.useIndex).toBe(false);expect(create).not.toHaveBeenCalled();
 });
 it('saves, replaces and removes presets with Pro',async()=>{
  bindPro(manager(true) as never);const p=plugin();
  expect(await p.savePreset('Review','Notes','blue bird')).toBe(true);
  await p.savePreset('Review','Other','red fox');expect(p.settings.presets).toEqual([{name:'Review',folder:'Other',query:'red fox'}]);
  await p.removePreset('Review');expect(p.settings.presets).toEqual([]);
 });
 it('exports source links to a new file and preserves an existing export',async()=>{
  bindPro(manager(true) as never);const p=plugin();const result={matches:[{container:'A.md',source:'B.md',subpath:'#^ref',depth:1,excerpt:'blue bird'}],diagnostics:[],scanned:1,cancelled:false};
  const first=await p.export(result,'blue bird');const second=await p.export(result,'blue bird');
  expect(first?.path).toBe('Embedded text results.md');expect(second?.path).toBe('Embedded text results 2.md');
  expect(await p.app.vault.read(first!)).toContain('[[B.md#^ref]]');
 });
 it('the facade follows sponsorship changes and resets',()=>{
  const m=manager(false);bindPro(m as never);const fn=vi.fn();const off=onProChange(fn);m.set(true);expect(isPro()).toBe(true);expect(fn).toHaveBeenCalledOnce();off();resetPro();expect(isPro()).toBe(false);
  expect(SPONSORS).toMatchObject({clientId:'Ov23lic5UPGPZqhBlBGg',minMonthlyUsd:5,oneTimeUsd:15,oneTimeMonths:0});
 });
 it('core search works without a sponsor',async()=>{
  const p=plugin();const result=await p.runSearch({folder:'',query:'blue bird'});expect(result.matches[0]?.source).toBe('Source.md');expect(isPro()).toBe(false);
 });
});
describe('index',()=>{
 it('reads changed documents and reuses unchanged ones',async()=>{
  const index=new DocumentIndex();const read=vi.fn(async()=> 'blue bird');
  await index.read('A','1',read);await index.read('A','1',read);expect(read).toHaveBeenCalledOnce();
  index.invalidate('A');read.mockResolvedValue('red fox');expect((await index.read('A','1',read)).text).toBe('red fox');
  await index.read('A','2',read);expect(read).toHaveBeenCalledTimes(3);index.clear();expect(index.size).toBe(0);
 });
 it('does not store a document invalidated while a read is pending',async()=>{
  const index=new DocumentIndex();let finish!:(text:string)=>void;
  const pending=index.read('A','1',()=>new Promise(resolve=>{finish=resolve;}));index.invalidate('A');finish('old');await pending;expect(index.size).toBe(0);
 });
});
it('repairs stored data',()=>{expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);expect(normalizeSettings({presets:[null,{name:'x'}],useIndex:'yes',folder:8})).toEqual(DEFAULT_SETTINGS);});
it('parses CRLF and keeps embed offsets',()=>{const text='---\r\nx: 1\r\n---\r\n![[B]]';const doc=parseDocument(text);expect(doc.embeds[0]?.start).toBe(text.indexOf('!'));});
it('marks cancelled exports as partial',()=>{expect(exportResults({matches:[],diagnostics:[],scanned:0,cancelled:true},'x')).toContain('partial');});
it('escapes excerpt markup in an exported list',()=>{
 const text=exportResults({matches:[{container:'A.md',source:'B.md',subpath:'',depth:1,excerpt:'# title ![image](https://example.test/x)'}],diagnostics:[],scanned:1,cancelled:false},'[x]*');
 expect(text).toContain('\\# title \\!\\[image\\]');expect(text).toContain('Query: \\[x\\]\\*');
});
it('does not refill an index cleared during a pending read',async()=>{
 const index=new DocumentIndex();let finish!:(text:string)=>void;
 const pending=index.read('A','1',()=>new Promise(resolve=>{finish=resolve;}));index.clear();finish('old');await pending;expect(index.size).toBe(0);
});
