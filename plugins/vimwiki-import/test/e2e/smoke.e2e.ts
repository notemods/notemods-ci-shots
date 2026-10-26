import { browser, expect } from '@wdio/globals';
import type VimwikiImportPlugin from '../../src/main';
import { pluginId, reloadPlugin } from './load';
describe('Vimwiki import in Obsidian', function () {
 it('loads and reloads with no errors',async()=>expect(await reloadPlugin(pluginId)).toEqual({enabled:true,reloaded:true,errors:[]}));
 it('previews in the dialog and cancel writes nothing',async()=>{
  await browser.executeObsidian(async({app})=>{
   await app.vault.createFolder('Wiki');await app.vault.create('Wiki/a.wiki','= Title =\n== Part ==\n[[b|Label]]\n[[https://example.com|Site]]\n# Read reference\n[[/b|Root]]');await app.vault.create('Wiki/b.wiki','B');
   const p=(app as unknown as {plugins:{plugins:Record<string,VimwikiImportPlugin>}}).plugins.plugins['vimwiki-import'];p.pro!.signOut();p.settings={source:'Wiki',destination:'Notes',diary:''};
  });
  await browser.executeObsidianCommand('vimwiki-import:preview-import');
  const modal=browser.$('.vimwiki-import-modal');await modal.waitForDisplayed();await modal.$('.checkbox-container').click();await modal.$('button.mod-cta').click();
  await browser.waitUntil(async()=>await modal.$('.vimwiki-preview').isExisting(),{timeout:10000});
  expect(await modal.$('.vimwiki-preview').getText()).toContain('[[Notes/b|Label]]');expect(await modal.$('.vimwiki-preview').getText()).toContain('# Title');
  await modal.$('button=Cancel').click();expect(await browser.executeObsidian(({app})=>app.vault.getAbstractFileByPath('Notes')===null)).toBe(true);
 });
 it('imports from the preview and retains sources',async()=>{
  await browser.executeObsidianCommand('vimwiki-import:preview-import');const modal=browser.$('.vimwiki-import-modal');await modal.waitForDisplayed();await modal.$('.checkbox-container').click();await modal.$('button.mod-cta').click();
  await browser.waitUntil(async()=>await modal.$('.vimwiki-preview').isExisting(),{timeout:10000});await modal.$('button=Import').click();
  await browser.waitUntil(async()=>(await modal.getText()).includes('Created 2 notes.'),{timeout:10000});
  const result=await browser.executeObsidian(async({app})=>({output:await app.vault.read(app.vault.getFileByPath('Notes/a.md')!),source:await app.vault.read(app.vault.getFileByPath('Wiki/a.wiki')!),report:await app.vault.read(app.vault.getFileByPath('Notes/Vimwiki report.md')!)}));
  expect(result.output).toBe('# Title\n## Part\n[[Notes/b|Label]]\n[Site](https://example.com)\n1. Read reference\n[[Notes/b|Root]]');expect(result.source).toContain('= Title =');expect(result.report).toContain('Created: 2');await modal.$('button=Close').click();
 });
 it('skips changed sources and output conflicts',async()=>{
  const result=await browser.executeObsidian(async({app})=>{
   const p=(app as unknown as {plugins:{plugins:Record<string,VimwikiImportPlugin>}}).plugins.plugins['vimwiki-import'];const plan=await p.preview('Wiki','Conflicts');
   await app.vault.modify(app.vault.getFileByPath('Wiki/a.wiki')!,'Changed');await app.vault.createFolder('Conflicts');await app.vault.create('Conflicts/b.md','Keep');
   return {...await p.importPlan(plan),existing:await app.vault.read(app.vault.getFileByPath('Conflicts/b.md')!)};
  });
  expect(result.created).toEqual([]);expect(result.existing).toBe('Keep');expect(result.issues.map(i=>i.reason)).toEqual(['Source changed or missing; page skipped.','Output conflict; page skipped.']);
 });
 it('guards both Pro features while signed out',async()=>{
  const errors=await browser.executeObsidian(async({app})=>{
   const p=(app as unknown as {plugins:{plugins:Record<string,VimwikiImportPlugin>}}).plugins.plugins['vimwiki-import'];p.pro!.signOut();const errors:string[]=[];
   try{await p.preview('Wiki','Pro guard','Daily');}catch(e){errors.push(String(e));}try{await p.writeCombined();}catch(e){errors.push(String(e));}return errors;
  });expect(errors.length).toBe(2);expect(errors.every(e=>e.includes('Pro'))).toBe(true);
 });
 it('maps diary links and combines saved unresolved results with a simulated sponsor',async()=>{
  const result=await browser.executeObsidian(async({app})=>{
   const p=(app as unknown as {plugins:{plugins:Record<string,VimwikiImportPlugin>}}).plugins.plugins['vimwiki-import'];
   const manager=p.pro as unknown as {opts:{http:()=>Promise<unknown>};refreshNow():Promise<unknown>;signOut():void};
   manager.opts.http=async()=>({status:200,json:{data:{viewer:{login:'demo-reader'},user:{sponsorshipForViewerAsSponsor:{isActive:true,isOneTimePayment:false,tier:{name:'$5 a month',monthlyPriceInCents:500}}}}}});app.secretStorage.setSecret('vimwiki-import-github-token','gho_'+'0'.repeat(36));await manager.refreshNow();
   try{
    await app.vault.createFolder('Diary');await app.vault.createFolder('Diary/diary');await app.vault.create('Diary/index.wiki','[[diary/2026-10-14|Today]] [[missing-one]]');await app.vault.create('Diary/diary/2026-10-14.wiki','= Day =');await p.importPlan(await p.preview('Diary','Diary notes','Daily'));
    await app.vault.createFolder('Other');await app.vault.create('Other/a.wiki','[[missing-two]]');await p.importPlan(await p.preview('Other','Other notes'));const report=await p.writeCombined();
    return {diary:await app.vault.read(app.vault.getFileByPath('Daily/2026-10-14.md')!),link:await app.vault.read(app.vault.getFileByPath('Diary notes/index.md')!),report:await app.vault.read(app.vault.getFileByPath(report)!)};
   }finally{manager.signOut();}
  });expect(result.diary).toBe('# Day');expect(result.link).toContain('[[Daily/2026-10-14|Today]]');expect(result.report).toContain('missing-one');expect(result.report).toContain('missing-two');
 });
});
