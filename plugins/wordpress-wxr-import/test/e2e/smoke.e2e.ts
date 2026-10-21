import { browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { pluginId, reloadPlugin } from './load';
import type Plugin from '../../src/main';
import type { ImportModal } from '../../src/modal';
const xml = readFileSync('tests/fixtures/three-records.xml', 'utf8');
interface Plugins { plugins: Record<string, Plugin> }
describe('WordPress WXR import in Obsidian', () => {
 it('loads and reloads without errors', async () => expect(await reloadPlugin(pluginId)).toEqual({enabled:true,reloaded:true,errors:[]}));
 it('previews a selected local file and creates notes through the modal', async () => {
  const preview = await browser.executeObsidian(async ({app}, source, id) => {
   const p = (app as unknown as {plugins:Plugins}).plugins.plugins[id]!;
   p.pro!.signOut(); const m = p.openImport();
   await m.selectFile(new File([source], 'sample.xml',{type:'application/xml'}));
   return {text:m.contentEl.textContent,button: [...m.contentEl.querySelectorAll('button')].find(b=>b.textContent==='Create notes')?.disabled};
  },xml,pluginId);
  expect(preview.text).toContain('1 posts · 2 pages · 3 notes to create'); expect(preview.button).toBe(false);
  const button = await browser.$('//div[contains(@class,"wxr-import")]//button[normalize-space(.)="Create notes"]'); await button.click();
  try { await browser.waitUntil(async () => (await browser.$('.wxr-status').getText()).includes('Created 3 notes'),{timeout:30000,timeoutMsg:'Import did not finish'}); }
  catch { throw new Error(await browser.$('.wxr-status').getText()); }
  const contents = await browser.executeObsidian(async ({app}) => {
   const read = async (path:string) => { const f = app.vault.getFileByPath(path); if (!f) throw new Error(`Missing ${path}`); return app.vault.read(f); };
   return { note:await read('WordPress import/Field journal-11.md'), index:await read('WordPress import/_index.md'),report:await read('WordPress import/_report.md') };
  });
  expect(contents.note).toContain('Hello **world**.'); expect(contents.note).toContain('A helpful comment'); expect(contents.note).toContain('source_id:'); expect(contents.index).toContain('Field journal-11'); expect(contents.report).toContain('nav\\_menu\\_item: 1');
  await browser.keys('Escape');
 });
 it('rejects an existing folder and malformed XML before creating notes', async () => {
  const result = await browser.executeObsidian(async ({app}, source,id) => {
   const p = (app as unknown as {plugins:Plugins}).plugins.plugins[id]!; const messages:string[]=[];
   await app.vault.createFolder('Existing folder');await app.vault.create('Existing folder/keep.md','Original');
   for (const [data,folder] of [[source,'Existing folder'],['<rss><channel></rss>','Invalid'],['<!DOCTYPE rss>'+source,'Doctype']]) {
    try { await p.importXml(data!,folder!); messages.push('unexpected success'); } catch(e) { messages.push(String(e)); }
   }
   return {messages,invalid:app.vault.getAbstractFileByPath('Invalid') !== null,doctype:app.vault.getAbstractFileByPath('Doctype') !== null};
  },xml,pluginId);
  expect(result.messages[0]).toContain('folder exists'); expect(result.messages[1]).toContain('Malformed XML'); expect(result.messages[2]).toContain('DOCTYPE'); expect(result.invalid).toBe(false); expect(result.doctype).toBe(false);
 });
 it('keeps media URLs as links and shortcode text without requests', async () => {
  const result=await browser.executeObsidian(async ({app},source,id)=>{
   const p=(app as unknown as {plugins:Plugins}).plugins.plugins[id]!;
   const oldFetch=window.fetch; let requests=0;window.fetch=(...args:Parameters<typeof fetch>)=>{requests++;return oldFetch(...args);};
   try {
    const plan=await p.importXml(source.replace('<p>Hello <strong>world</strong>.</p>','<p><img src="https://example.org/photo.jpg" alt="Photo"></p><p>[gallery ids="1"]</p>'),'Media links');
    return {text:plan.files[0]!.content,requests,shortcodes:plan.parsed.shortcodes};
   } finally {window.fetch=oldFetch;}
  },xml,pluginId);
  expect(result.text).toContain('[Photo](https://example.org/photo.jpg)');expect(result.text).not.toContain('![');expect(result.text).toContain('[gallery ids="1"]');expect(result.requests).toBe(0);expect(result.shortcodes).toBe(1);
 });
 it('blocks paid actions when signed out', async()=>{
  const messages=await browser.executeObsidian(async({app},source,id)=>{
   const p=(app as unknown as {plugins:Plugins}).plugins.plugins[id]!;p.pro!.signOut();const errors:string[]=[];
   try {await p.saveProfile({name:'Blog',folder:'Profile',mapping:{}});}catch(e){errors.push(String(e));}
   try {await p.importXml(source,'Free review',{},'WordPress import');}catch(e){errors.push(String(e));}
   return errors;
  },xml,pluginId);expect(messages).toHaveLength(2);expect(messages[0]).toContain('Pro');expect(messages[1]).toContain('Pro');
 });
 it('saves a profile and compares source IDs through the sponsor manager', async()=>{
  const result=await browser.executeObsidian(async({app},source,id)=>{
   const p=(app as unknown as {plugins:Plugins}).plugins.plugins[id]!;
   p.pro!.signOut();await p.importXml(source,'Baseline');
   p.pro!.opts.http=async()=>({status:200,json:{data:{viewer:{login:'demo-reader'},user:{sponsorshipForViewerAsSponsor:{isActive:true,isOneTimePayment:false,tier:{name:'$5 a month',monthlyPriceInCents:500}}}}}});
   app.secretStorage.setSecret(`${id}-github-token`,'gho_'+'0'.repeat(36));await p.pro!.refreshNow();
   try {
    await p.saveProfile({name:'Blog',folder:'Review',mapping:{author:'writer'}});
    const updated=source.replace('Our first field visit.','Our second field visit.').replace(/<item><title>Contact[\s\S]*?<\/item>/,'');
    const plan=await p.importXml(updated,'Review',{author:'writer'},'Baseline');
    const original=app.vault.getFileByPath('Baseline/Field journal-11.md');if(!original)throw new Error('Missing original');
    return {changes:plan.changes,count:plan.noteCount,note:plan.files[0]!.content,original:await app.vault.read(original),profile:p.settings.profiles[0]};
   } finally {p.pro!.signOut();}
  },xml,pluginId);
  expect(result.changes).toEqual([{id:'11',state:'changed'},{id:'13',state:'removed'}]);expect(result.count).toBe(1);expect(result.note).toContain('writer: Writer');expect(result.note).toContain('second field');expect(result.original).toContain('first field');expect(result.profile?.name).toBe('Blog');
 });
 it('shows a persistent error in the import window',async()=>{
  const text=await browser.executeObsidian(async({app},id)=>{
   const p=(app as unknown as {plugins:Plugins}).plugins.plugins[id]!;const m:ImportModal=p.openImport();await m.selectFile(new File(['<rss>'],'broken.xml'));const message=m.contentEl.querySelector('.wxr-status')?.textContent;m.close();return message;
  },pluginId);expect(text).toContain('Malformed XML');
 });
});
