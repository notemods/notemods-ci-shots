import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId } from './load';
const TASKS='obsidian-tasks-plugin';
const source='# Team plan\n\n- [ ] Call 📅 team [[Project]] 🔺 🔁 every week 📅 2026-10-15\n- [ ] Write report ⏫ 🛫 2026-10-13 ⏳ 2026-10-14 📅 2026-10-16\n- [x] Prepare agenda ➕ 2026-10-01 ✅ 2026-10-11\n';
const report='# Weekly report\n\n```tasks\npath includes Team plan\n```\n';
interface P { settings: Record<string,unknown>; saveSettings():Promise<void>; refresh():void; renders:Set<{adapter:{count:number;observing:boolean;scan():void}}>;
 pro:{signOut():void;isPro():boolean;refreshNow():Promise<void>;opts:{http:unknown}} }
async function settings(patch:Record<string,unknown>) {
 await browser.executeObsidian(async ({app},id,v)=>{ const p=(app as unknown as {plugins:{plugins:Record<string,P>}}).plugins.plugins[id]!; Object.assign(p.settings,v); await p.saveSettings(); },pluginId,patch);
}
async function open(path:string, mode:'preview'|'source'='preview') {
 await obsidianPage.openFile(path);
 await browser.executeObsidian(async ({app},m)=>{ const leaf=app.workspace.getMostRecentLeaf()!; const state=leaf.getViewState(); await leaf.setViewState({...state,state:{...state.state,mode:m,source:false}}); },mode);
}
async function fields() {
 return browser.execute(()=>Array.from(document.querySelectorAll('.workspace-leaf.mod-active li.plugin-tasks-list-item .task-due')).filter((e)=>e.getClientRects().length>0).map((e)=>e.textContent));
}
async function waitDue(label='Due:', count=2) {
 try { await browser.waitUntil(async()=>{const f=await fields();return f.length>=count && f.every((x)=>x?.includes(label));},{timeout:10000,interval:100,timeoutMsg:'Supported due fields did not render'}); } catch(e) { console.log('DOM diagnostic',await browser.execute(()=>Array.from(document.querySelectorAll('.workspace-leaf.mod-active .task-due')).map(e=>({text:e.textContent,visible:e.getClientRects().length>0}))));throw e; }
}
async function read(path='Team plan.md') { return browser.executeObsidian(async({app},p)=>app.vault.read(app.vault.getFileByPath(p)!),path); }
async function pro(on:boolean) {
 await browser.executeObsidian(async({app},id,on)=>{
  const p=(app as unknown as {plugins:{plugins:Record<string,P>}}).plugins.plugins[id]!;
  if(!on){ p.pro.signOut(); return; }
  p.pro.opts.http=async()=>({status:200,json:{data:{viewer:{login:'demo-reader'},user:{sponsorshipForViewerAsSponsor:{isActive:true,isOneTimePayment:false,tier:{name:'$5 a month',monthlyPriceInCents:500}}}}}});
  for(let i=0;i<20&&!p.pro.isPro();i++){app.secretStorage.setSecret(id+'-github-token','gho_'+'0'.repeat(36));await p.pro.refreshNow(); await Promise.resolve();}
  if(!p.pro.isPro())throw new Error('Mock sponsor check failed');
 },pluginId,on);
}
describe('Tasks 8.5.0 field adapter',function(){
 before(async()=>{ await browser.executeObsidian(({obsidian})=>{ const original=obsidian.Menu.prototype.showAtPosition; obsidian.Menu.prototype.showAtPosition=function(...args){this.setUseNativeMenu(false);return original.apply(this,args);}; (window as unknown as {restoreTaskMenu:()=>void}).restoreTaskMenu=()=>{obsidian.Menu.prototype.showAtPosition=original;}; }); await obsidianPage.enablePlugin(TASKS); await browser.waitUntil(()=>browser.executeObsidian(({app},id)=>Boolean((app as unknown as {plugins:{plugins:Record<string,{apiV1?:unknown}>}}).plugins.plugins[id]?.apiV1),TASKS),{timeout:15000}); await browser.execute(()=>{document.body.classList.remove('theme-dark');document.body.classList.add('theme-light');}); });
 after(async()=>{ await browser.execute(()=>(window as unknown as {restoreTaskMenu:()=>void}).restoreTaskMenu()); });
 beforeEach(async()=>{ await pro(false); await settings({enabled:true,selectedPreset:'',compact:false,folderRules:''}); await obsidianPage.write('Team plan.md',source); await obsidianPage.write('Weekly report.md',report); await obsidianPage.write('Project.md','# Project\n\nProject context.'); });
 afterEach(async()=>{ await pro(false); await browser.keys('Escape'); await settings({enabled:true}); });
 it('labels inline fields and preserves description, links, and source',async()=>{
  await open('Team plan.md'); await waitDue();
  const text=await browser.execute(()=>document.querySelector('.workspace-leaf.mod-active .markdown-preview-view')?.textContent??'');
  expect(text).toContain('Priority: Highest'); expect(text).toContain('Repeat: every week');expect(text).toContain('Call 📅 team');expect(text).toContain('Done: 2026-10-11');expect(await read()).toBe(source);
  const link=await browser.$('.workspace-leaf.mod-active .task-description a.internal-link'); await link.click();
  await browser.waitUntil(()=>browser.executeObsidian(({app})=>app.workspace.getActiveFile()?.path==='Project.md'),{timeout:10000});
 });
 it('keeps the Tasks date editor and context menu',async()=>{
  await open('Team plan.md');await waitDue();
  await browser.execute(()=>Array.from(document.querySelectorAll('.workspace-leaf.mod-active .task-due > span')).find((e)=>e.getClientRects().length>0)?.dispatchEvent(new MouseEvent('click',{bubbles:true})));
  await browser.waitUntil(async()=> await browser.$('.flatpickr-calendar.open').isExisting(),{timeout:10000});
  expect(await browser.$('.flatpickr-calendar.open').getText()).toContain('Today');await browser.execute(()=>{ const field=Array.from(document.querySelectorAll('.workspace-leaf.mod-active .task-due')).find((e)=>e.getClientRects().length>0) as unknown as {_flatpickr:{destroy():void}};field._flatpickr.destroy(); });
  await browser.execute(()=>Array.from(document.querySelectorAll('.workspace-leaf.mod-active .task-due > span')).find((e)=>e.getClientRects().length>0)?.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,button:2,buttons:2,clientX:250,clientY:250})));
  await browser.waitUntil(async()=> await browser.$('.menu').isExisting(),{timeout:10000});
  expect(await browser.$('.menu').getText()).toContain('date');await browser.keys('Escape');expect(await read()).toBe(source);
 });
 it('labels query results and late inserted rows without duplicate labels',async()=>{
  await open('Weekly report.md');await waitDue();
  await obsidianPage.write('Team plan.md',source+'- [ ] Late task 📅 2026-10-17\n');await waitDue('Due:',3);
  await browser.executeObsidian(({app},id)=>{const p=(app as unknown as {plugins:{plugins:Record<string,P>}}).plugins.plugins[id]!;for(let i=0;i<10;i++)for(const r of p.renders)r.adapter.scan();},pluginId);
  expect((await fields()).every((x)=>(x?.match(/Due:/g)??[]).length===1)).toBe(true);
 });
 it('restores current note and query fields and stops observers',async()=>{
  await open('Team plan.md');await waitDue();await open('Weekly report.md');await waitDue();await settings({enabled:false});
  expect((await fields()).every((x)=>x?.includes('📅')&&!x.includes('Due:'))).toBe(true);
  expect(await browser.executeObsidian(({app},id)=>Array.from((app as unknown as {plugins:{plugins:Record<string,P>}}).plugins.plugins[id]!.renders).every((r)=>!r.adapter.observing),pluginId)).toBe(true);
  await open('Team plan.md');expect(await read()).toBe(source);await settings({enabled:true});await waitDue();
 });
 it('toggles a recurring query task once in Live Preview and labels refreshed fields',async()=>{
  await open('Weekly report.md','source');await waitDue();
  await browser.executeObsidian(({app})=>{const w=window as unknown as {testTaskWrites:number;testTaskOff:()=>void};w.testTaskWrites=0;const ref=app.vault.on('modify',(f)=>{if(f.path==='Team plan.md')w.testTaskWrites++;});w.testTaskOff=()=>app.vault.offref(ref);});
  try {
   await browser.execute(()=>{const row=Array.from(document.querySelectorAll<HTMLElement>('.workspace-leaf.mod-active li.plugin-tasks-list-item')).find((e)=>e.textContent?.includes('Call 📅 team'));const check=row?.querySelector<HTMLInputElement>('input[type=checkbox]');if(!check)throw new Error('Query checkbox missing');check.click();});
   await browser.waitUntil(async()=>{const t=await read();return t.includes('- [x] Call')&&t.includes('📅 2026-10-22');},{timeout:20000,interval:100});
   await waitDue('Due:',3);
   expect(await browser.execute(()=> (window as unknown as {testTaskWrites:number}).testTaskWrites)).toBe(1);
   expect((await read()).split('Call 📅 team').length-1).toBe(2);
  }finally{await browser.execute(()=>(window as unknown as {testTaskOff:()=>void}).testTaskOff());}
 });
 it('applies Pro labels, saved presets, folder rules, and compact layout',async()=>{
  await open('Weekly report.md');await waitDue();await pro(true);
  await settings({presets:{Team:{labels:{due:'Deadline'},compact:true}},selectedPreset:'Team'});await waitDue('Deadline:');
  expect(await browser.execute(()=>document.querySelector('.workspace-leaf.mod-active .task-due')?.classList.contains('task-field-labels-compact'))).toBe(true);
  await settings({folderRules:'Weekly report.md|off'});expect((await fields()).every((x)=>x?.includes('📅'))).toBe(true);
  await pro(false);await waitDue('Due:');expect(await browser.execute(()=>document.querySelector('.workspace-leaf.mod-active .task-due')?.classList.contains('task-field-labels-compact'))).toBe(false);
 });
 it('leaves ordinary rendered tasks alone with Tasks disabled',async()=>{
  await obsidianPage.disablePlugin(TASKS);
  try{await open('Team plan.md');expect(await read()).toBe(source);expect(await browser.execute(()=>document.querySelectorAll('.workspace-leaf.mod-active .task-due').length)).toBe(0);}
  finally{await obsidianPage.enablePlugin(TASKS);}
 });
});
