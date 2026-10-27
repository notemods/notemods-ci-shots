import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', async importOriginal => {
 const actual = await importOriginal<Record<string, unknown>>();
 class Value { constructor(private text:string) {} toString() { return this.text; } }
 class View {
  private cleanup:Array<()=>void>=[];
  register(fn:()=>void) { this.cleanup.push(fn); }
  registerInterval(id:number) { this.register(()=>window.clearInterval(id)); }
  load() { (this as unknown as {onload:()=>void}).onload(); }
  unload() { for (const fn of this.cleanup) fn(); this.cleanup=[]; (this as unknown as {onunload:()=>void}).onunload(); }
 }
 class StickyNotice {
  containerEl=document.createElement('div');
  messageEl=this.containerEl;
  constructor(message:DocumentFragment, public duration:number) { this.containerEl.className='test-notice'; this.containerEl.dataset.duration=String(duration); this.containerEl.append(message); document.body.append(this.containerEl); }
  hide() { this.containerEl.remove(); }
 }
 return {...actual, BasesView:View, DateValue:Value, StringValue:Value, Notice:StickyNotice};
});
import { StringValue, type QueryController } from 'obsidian';
import Plugin from '../src/main';
import { AlertView } from '../src/view';
import { bindPro } from '../src/pro';
import { rowsFor, type Ledger } from '../src/alerts';

function host() {
 const p = Object.create(Plugin.prototype) as Plugin;
 Object.assign(p,{manifest:{id:'date-property-alerts'}, running:true, startedAt:0, ledger:{} as Ledger, views:new Set(),notices:new Map(), app:{saveLocalStorage:vi.fn(),'workspace':{openLinkText:vi.fn()}, metadataCache:{getFileCache:()=>({frontmatter:{due:'2020-01-01'}})}}});
 return p;
}
function view(p:Plugin) {
 const container=document.body.createDiv();
 const v=new AlertView({} as QueryController,container,p);
 Object.assign(v,{app:p.app,config:{name:'Reviews',getAsPropertyId:()=> 'note.due',get:()=>undefined},data:{data:[{file:{path:'Review.md',extension:'md'},getValue:()=>new StringValue('2020-01-01')}]}});
 v.load(); v.tick(); return v;
}
beforeEach(()=>vi.useFakeTimers());
afterEach(()=>{vi.useRealTimers(); bindPro(null); document.body.empty();});

describe('notice and view lifecycle',()=>{
 it('keeps a sticky notice unread until clicked',()=>{
  const p=host(), r=rowsFor([{path:'Review.md',value:'2020-01-01'}],'note.due').rows[0]!;
  p.notify(r); expect(p.ledger[r.key]?.delivered).not.toBe(true);
  vi.advanceTimersByTime(60000); expect(document.querySelector('.test-notice')).not.toBeNull();
  expect((document.querySelector('.test-notice') as HTMLElement).dataset.duration).toBe('0');
  (document.querySelector('.test-notice button') as HTMLElement).click();
  expect(p.ledger[r.key]?.delivered).toBe(true); expect(document.querySelector('.test-notice')).toBeNull();
 });
 it('deduplicates notices across two live views before acknowledgement',()=>{
  const p=host(); view(p); view(p);
  expect(document.querySelectorAll('.test-notice')).toHaveLength(1);
  expect(Object.values(p.ledger).every(s=>!s.delivered)).toBe(true); p.onunload();
 });
 it('stops every view interval when plugin unloads',()=>{
  const p=host(); view(p); view(p); expect(vi.getTimerCount()).toBe(2);
  p.onunload(); expect(vi.getTimerCount()).toBe(0); expect(p.views.size).toBe(0); expect(document.querySelector('.test-notice')).toBeNull();
 });
 it('closing one source clears only its timer',()=>{
  const p=host(), a=view(p); view(p); a.unload(); expect(vi.getTimerCount()).toBe(1); expect(p.views.size).toBe(1); p.onunload();
 });
 it('keeps keyboard focus through an unchanged tick',()=>{
  const p=host(), v=view(p); const button=document.querySelector('.dpa-open') as HTMLButtonElement; button.focus(); v.tick();
  expect(document.activeElement).toBe(button); p.onunload();
 });
 it('dismiss hides the card in every source and cancels its notice',()=>{
  const p=host(); view(p); view(p);
  const button=Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Dismiss')!; button.click();
  expect(document.querySelectorAll('.dpa-row')).toHaveLength(0); expect(document.querySelector('.test-notice')).toBeNull();
  expect(Array.from(document.querySelectorAll('.dpa-summary')).every(s=>s.textContent?.startsWith('0 due'))).toBe(true); p.onunload();
 });
 it('free snooze is available in the view',()=>{
  const p=host(); view(p);
  const button=Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Snooze 15 minutes')!; expect(button).toBeDefined(); button.click();
  expect(document.body.textContent).toContain('Until'); expect(document.querySelector('.test-notice')).toBeNull(); p.onunload();
 });
 it('updates Pro controls immediately on a sponsorship change',()=>{
  let pro=false; let change=()=>{}; const stop=vi.fn();
  bindPro({isPro:()=>pro,onChange:(cb:()=>void)=>{change=cb;return stop;},hasToken:()=>false,isChecking:()=>false,getState:()=>({status:'unchecked',lastAttemptAt:0}),config:{sponsorLogin:'theluckystrike',source:'date-property-alerts'}} as never);
  const p=host(); view(p);
  // A free select of a Pro snooze does not snooze. After the Pro change, the same button snoozes at once.
  Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Snooze 1 hour')!.click(); expect(document.body.textContent).not.toContain('Until');
  pro=true; change();
  Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Snooze 1 hour')!.click(); expect(document.body.textContent).toContain('Until'); p.onunload(); expect(stop).toHaveBeenCalledOnce();
 });
});
