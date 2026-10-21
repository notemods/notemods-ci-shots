import { browser, expect } from '@wdio/globals';
import type Finder from '../../src/main';
import type { SearchResult } from '../../src/search';
import { pluginId } from './load';

type PluginHost = { plugins: { plugins: Record<string, Finder> } };
async function run(query:string):Promise<SearchResult> {
 return browser.executeObsidian(async({app},id,q)=>{
  const p=(app as unknown as PluginHost).plugins.plugins[id]!;
  return p.runSearch({folder:'Embedded Text Finder/Review',query:q});
 },pluginId,query);
}
describe('Embedded text finder',()=>{
 before(async()=>{
  await browser.waitUntil(async()=>browser.executeObsidian(({app})=>{
   const files=app.vault.getMarkdownFiles();
   const heading=files.find(f=>f.path.endsWith('/Trail plan.md'));
   const block=files.find(f=>f.path.endsWith('/Witness.md'));
   const daily=files.find(f=>f.path.endsWith('/Daily review.md'));
   return !!heading && !!block && !!daily && !!app.metadataCache.getFileCache(heading)?.headings?.length && !!app.metadataCache.getFileCache(block)?.blocks?.ref && !!app.metadataCache.getFileCache(daily)?.embeds?.length && !!app.metadataCache.getFirstLinkpathDest('Bird observations',daily.path);
  }),{timeout:30000,timeoutMsg:'Sample metadata is not ready'});
 });
 it('returns whole-note, heading, block and depth-two sources',async()=>{
  const result=await run('blue bird');
  expect(result.cancelled).toBe(false);
  expect(result.matches).toEqual(expect.arrayContaining([
   expect.objectContaining({container:'Embedded Text Finder/Review/Daily review.md',source:'Embedded Text Finder/Sources/Bird observations.md',depth:1}),
   expect.objectContaining({container:'Embedded Text Finder/Review/Heading review.md',subpath:'#Scope'}),
   expect.objectContaining({container:'Embedded Text Finder/Review/Block review.md',subpath:'#^ref'}),
   expect.objectContaining({container:'Embedded Text Finder/Review/Nested review.md',source:'Embedded Text Finder/Sources/Deep source.md',depth:2}),
  ]));
  expect(result.matches.some(m=>m.container.endsWith('/Fenced example.md'))).toBe(false);
 });
 it('excludes text outside a heading and block',async()=>{
  const result=await run('red fox');
  expect(result.matches.some(m=>m.container.endsWith('/Heading review.md')||m.container.endsWith('/Block review.md'))).toBe(false);
 });
 it('reports missing files, media, depth limit and cycles',async()=>{
  const result=await run('blue bird');
  expect(result.diagnostics.map(d=>d.reason)).toEqual(expect.arrayContaining(['Missing Markdown target','Skipped non-Markdown source','Depth limit','Cycle']));
  expect(result.matches.some(m=>m.source.endsWith('/Level three.md'))).toBe(false);
 });
 it('searches literal bracket and star characters',async()=>{
  const result=await run('[blue]*');expect(result.matches).toHaveLength(1);expect(result.matches[0]?.source).toContain('/Literal.md');
 });
 it('opens the command modal and renders results with source buttons',async()=>{
  await browser.executeObsidian(({app},id)=>{
   const p=(app as unknown as PluginHost).plugins.plugins[id]!;for(const m of [...p.modals])m.close();
   (app as unknown as {commands:{executeCommandById(id:string):boolean}}).commands.executeCommandById(id+':search');
  },pluginId);
  await browser.$('.etf-query').waitForDisplayed();
  const rendered=await browser.executeObsidian(async({app},id)=>{
   const p=(app as unknown as PluginHost).plugins.plugins[id]!;const m=[...p.modals][0]!;
   m.folder.value='Embedded Text Finder/Review';m.query.value='witness saw';await m.run();
   return {status:m.status.textContent,source:m.results.querySelector('.etf-source')?.textContent};
  },pluginId);
  expect(rendered.status).toContain('Search complete.');expect(rendered.source).toContain('#^ref');
  await browser.$('.etf-source').click();
  await browser.waitUntil(async()=>browser.executeObsidian(({app})=>app.workspace.getActiveFile()?.path.endsWith('/Witness.md')??false),{timeout:10000});
 });
 it('searches only the active note from the active note command',async()=>{
  await browser.executeObsidian(async({app},id)=>{
   const p=(app as unknown as PluginHost).plugins.plugins[id]!;for(const m of [...p.modals])m.close();
  },pluginId);
  // The source click of the test before opens Witness without an await. Wait until Daily review stays active.
  let stable=0;
  await browser.waitUntil(async()=>{
   const ok=await browser.executeObsidian(async({app})=>{
    const daily=app.vault.getMarkdownFiles().find(f=>f.path.endsWith('/Review/Daily review.md'))!;
    if(app.workspace.getActiveFile()?.path===daily.path)return true;
    const leaf=app.workspace.getLeaf(false);await leaf.openFile(daily);app.workspace.setActiveLeaf(leaf,{focus:true});
    return false;
   });
   stable=ok?stable+1:0;return stable>=2;
  },{timeout:15000,interval:300,timeoutMsg:'Daily review did not stay active'});
  await browser.executeObsidian(({app},id)=>{
   (app as unknown as {commands:{executeCommandById(id:string):boolean}}).commands.executeCommandById(id+':search-active');
  },pluginId);
  await browser.$('.etf-active').waitForDisplayed();
  const rendered=await browser.executeObsidian(async({app},id)=>{
   const p=(app as unknown as PluginHost).plugins.plugins[id]!;const m=[...p.modals][0]!;
   const state={checked:m.activeOnly.checked,folderOff:m.folder.disabled};
   m.query.value='blue bird';const result=await m.run();m.close();
   return {...state,containers:[...new Set(result?.matches.map(x=>x.container))]};
  },pluginId);
  expect(rendered).toEqual({checked:true,folderOff:true,containers:['Embedded Text Finder/Review/Daily review.md']});
 });
 it('reads changed source text on the next on-demand search',async()=>{
  const source='Embedded Text Finder/Sources/Changed source.md';const container='Embedded Text Finder/Review/Changed review.md';
  await browser.executeObsidian(async({app},source,container)=>{await app.vault.create(source,'initial phrase');await app.vault.create(container,'![[Embedded Text Finder/Sources/Changed source]]');},source,container);
  try{
   await browser.waitUntil(async()=>browser.executeObsidian(({app},source,container)=>app.metadataCache.getFirstLinkpathDest(source,container)?.path===source,source,container),{timeout:10000});
   expect((await run('initial phrase')).matches.some(m=>m.container===container)).toBe(true);
   await browser.executeObsidian(async({app},source)=>{const file=app.vault.getMarkdownFiles().find(f=>f.path===source)!;await app.vault.modify(file,'updated phrase');},source);
   expect((await run('initial phrase')).matches.some(m=>m.container===container)).toBe(false);
   expect((await run('updated phrase')).matches.some(m=>m.container===container)).toBe(true);
  }finally{
   await browser.executeObsidian(async({app},source,container)=>{for(const path of [source,container]){const f=app.vault.getAbstractFileByPath(path);if(f)await app.vault.delete(f);}},source,container);
  }
 });
 it('keeps the Pro actions off when signed out',async()=>{
  const state=await browser.executeObsidian(async({app},id)=>{
   const p=(app as unknown as PluginHost).plugins.plugins[id]!;p.pro!.signOut();
   return {preset:await p.savePreset('Free','','blue bird'),index:await p.setIndex(true),export:await p.export({matches:[],diagnostics:[],scanned:0,cancelled:false},'bird')};
  },pluginId);
  expect(state).toEqual({preset:false,index:false,export:null});
 });
 it('opens the matched root source when the container folder has the same file name',async()=>{
  const paths=['R3 root source.md','Embedded Text Finder/Review/R3 root source.md','Embedded Text Finder/Review/R3 root container.md'];
  await browser.executeObsidian(async({app},paths)=>{
   await app.vault.create(paths[0]!,'unique root bird');
   await app.vault.create(paths[1]!,'local decoy');
   await app.vault.create(paths[2]!,'![[/R3 root source]]');
  },paths);
  try{
   await browser.waitUntil(async()=>browser.executeObsidian(({app},paths)=>app.metadataCache.getFirstLinkpathDest('/R3 root source',paths[2]!)?.path===paths[0],paths),{timeout:10000});
   await browser.executeObsidian(async({app},id)=>{
    const p=(app as unknown as PluginHost).plugins.plugins[id]!;for(const m of [...p.modals])m.close();
    const m=p.openSearch();m.folder.value='Embedded Text Finder/Review';m.query.value='unique root bird';await m.run();
   },pluginId);
   await browser.$('.etf-source').click();
   expect(await browser.executeObsidian(({app})=>app.workspace.getActiveFile()?.path)).toBe(paths[0]);
  }finally{
   await browser.executeObsidian(async({app},paths)=>{for(const path of paths){const file=app.vault.getAbstractFileByPath(path);if(file)await app.vault.delete(file);}},paths);
  }
 });
 it('runs Pro presets, index refresh and linked export with a local sponsor fixture',async()=>{
  const state=await browser.executeObsidian(async({app},id)=>{
   const p=(app as unknown as PluginHost).plugins.plugins[id]!;
   const oldHttp=p.pro!.opts.http;
   p.pro!.opts.http=async()=>({status:200,json:{data:{viewer:{login:'demo-reader'},user:{sponsorshipForViewerAsSponsor:{isActive:true,isOneTimePayment:false,tier:{name:'$5 a month',monthlyPriceInCents:500}}}}}});
   app.secretStorage.setSecret(id+'-github-token','gho_'+'0'.repeat(36));
   let file:import('obsidian').TFile|null=null;
   try{
    await p.pro!.refreshNow();await p.savePreset('Bird review','Embedded Text Finder/Review','blue bird');await p.setIndex(true);
    const a=await p.runSearch({folder:'Embedded Text Finder/Review',query:'blue bird'});const size=p.index.size;
    const b=await p.runSearch({folder:'Embedded Text Finder/Review',query:'blue bird'});
    file=await p.export(b,'blue bird');
    return {preset:p.settings.presets.some(v=>v.name==='Bird review'),size,same:JSON.stringify(a)===JSON.stringify(b),text:file?await app.vault.cachedRead(file):''};
   }finally{
    if(file)await app.vault.delete(file);await p.removePreset('Bird review');await p.setIndex(false);p.pro!.signOut();p.pro!.opts.http=oldHttp;
   }
  },pluginId);
  expect(state.preset).toBe(true);expect(state.size).toBeGreaterThan(0);expect(state.same).toBe(true);expect(state.text).toContain('[[Embedded Text Finder/Sources/Witness.md#^ref]]');
 });
});
