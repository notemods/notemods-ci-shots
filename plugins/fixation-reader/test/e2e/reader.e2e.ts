import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId } from './load';

interface Plugin {
 settings: { enabled: boolean; strength: number; minimum: number; livePreview: boolean; excludedFolders: string; excludedTags: string; weight: number; color: string; endingOpacity: number };
 saveSettings(): Promise<void>;
 toggle(): Promise<void>;
 pro: { opts: { http: unknown }; refreshNow(): Promise<void>; signOut(): void };
}
async function configure(values: Partial<Plugin['settings']> = {}, pro = false): Promise<void> {
 await browser.executeObsidian(async ({ app }, id, values, pro) => {
  const p = (app as unknown as { plugins: { plugins: Record<string, Plugin> } }).plugins.plugins[id]!;
  p.pro.signOut();
  Object.assign(p.settings, { enabled:true,strength:.5,minimum:1,livePreview:false,excludedFolders:'',excludedTags:'',weight:700,color:'',endingOpacity:1 }, values);
  if(pro) {
   p.pro.opts.http = async () => ({status:200,json:{data:{viewer:{login:'demo-reader'},user:{sponsorshipForViewerAsSponsor:{isActive:true,isOneTimePayment:false,tier:{name:'$5 a month',monthlyPriceInCents:500}}}}}});
   app.secretStorage.setSecret(`${id}-github-token`,'gho_'+'0'.repeat(36));
   await p.pro.refreshNow();
  }
  await p.saveSettings();
 },pluginId,values,pro);
}
async function open(path: string, text: string, mode: 'preview' | 'source' = 'preview', source = false): Promise<void> {
 await obsidianPage.write(path,text);
 await obsidianPage.openFile(path);
 await browser.waitUntil(async () => browser.executeObsidian(({app}, path) => !!app.metadataCache.getCache(path),path), {timeout:10000,timeoutMsg:'note metadata is not ready'});
 await browser.executeObsidian(async ({app},path,mode,source) => {
  await app.workspace.getMostRecentLeaf()!.setViewState({type:'markdown',state:{file:path,mode,source}});
 },path,mode,source);
 await browser.waitUntil(async()=>browser.executeObsidian(({app,obsidian},path,mode,text)=>{const v=app.workspace.getActiveViewOfType(obsidian.MarkdownView);return v?.file?.path===path && v.getMode()===mode && (mode==='preview'?v.previewMode.get():v.editor.getValue())===text;},path,mode,text),{timeout:15000,timeoutMsg:'the note view is not ready'});
}
async function state() {
 return browser.executeObsidian(({app,obsidian}) => {
  const v = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
  if(!v) return null;
  const el = v.previewMode.containerEl;
  return {file:v.file?.path,marks:Array.from(el.querySelectorAll('b.fx')).map(e=>e.textContent),protected:el.querySelectorAll('pre b.fx, code b.fx, strong b.fx, .math b.fx, mjx-container b.fx').length,
   live:v.containerEl.querySelectorAll('.cm-content .fx').length,endings:v.containerEl.querySelectorAll('.cm-content .fx-end').length,readingEndings:el.querySelectorAll('.fx-end').length,
   style:el.querySelector('b.fx')?.getAttribute('style')??'',text:el.textContent??''};
 });
}
async function waitMarks(n: number) {
 await browser.waitUntil(async()=> (await state())?.marks.length === n,{timeout:15000,interval:100,timeoutMsg:`expected ${n} Reading marks`});
}
describe('Fixation Reader in the real app', () => {
 it('uses the exact supplied word count and leaves Markdown bytes unchanged',async()=>{
  await configure(); const text='Reading is fast'; await open('Reading.md',text); await waitMarks(3);
  expect((await state())?.marks).toEqual(['Read','i','fa']); expect(await obsidianPage.read('Reading.md')).toBe(text);
  await configure({minimum:3}); await waitMarks(2); expect((await state())?.marks).toEqual(['Read','fa']);
 });
 it('handles accented words, hyphens and CJK text',async()=>{
  await configure(); await open('Letters.md','Übermäßig well-known, 日本語のテキスト'); await waitMarks(3);
  expect((await state())?.marks).toEqual(['Überm','we','kno']);
 });
 it('skips code, existing bold and math in Reading view',async()=>{
  await configure(); await open('Protected.md','Reading\n\n**Important note** and `foo bar`.\n\n```js\nconst value = 1\n```\n\n$x + y = z$\n');
  await browser.waitUntil(async()=> (await state())?.marks.includes('Read')??false,{timeout:15000});
  expect((await state())?.protected).toBe(0);
  expect((await state())?.marks).not.toContain('Imp'); expect((await state())?.marks).not.toContain('con');
 });
 it('the boolean note property turns fixation off',async()=>{
  await configure(); await open('Plain.md','---\nfixation: false\n---\nReading is fast'); await waitMarks(0);
  await browser.waitUntil(async()=> (await state())?.text.includes('Reading is fast')??false,{timeout:10000});
  expect((await state())?.marks).toEqual([]);
 });
 it('the toggle command rerenders two open Reading views and keeps their files',async()=>{
  await configure(); const text='Reading is fast'; await open('Toggle.md',text); await waitMarks(3);
  await browser.executeObsidian(async({app})=>{const file=app.vault.getFileByPath('Toggle.md')!;await app.workspace.getLeaf('tab').openFile(file,{state:{mode:'preview'}});});
  await waitMarks(3); await browser.executeObsidianCommand(`${pluginId}:toggle`);
  await browser.waitUntil(async()=> browser.executeObsidian(({app,obsidian})=>{let n=0;app.workspace.iterateAllLeaves(leaf=>{if(leaf.view instanceof obsidian.MarkdownView)n+=leaf.view.previewMode.containerEl.querySelectorAll('b.fx').length;});return n===0;}),{timeout:15000});
  expect(await obsidianPage.read('Toggle.md')).toBe(text);
  await browser.executeObsidianCommand(`${pluginId}:toggle`); await waitMarks(3);
 });
 it('free ignores Pro options; Pro applies style, folder and tag exclusions',async()=>{
  const opts={excludedFolders:'Archive',excludedTags:'skip',weight:900,color:'#527a99',endingOpacity:.5};
  await configure(opts);await open('Archive/Plan.md','Reading is fast');await waitMarks(3);
  expect((await state())?.readingEndings).toBe(0);expect((await state())?.style).toBe('');
  await configure(opts,true);await waitMarks(0);
  await open('Tagged.md','---\ntags: [skip]\n---\nReading is fast');await waitMarks(0);
  await open('Styled.md','Reading is fast');await waitMarks(3);expect((await state())?.readingEndings).toBe(3);expect((await state())?.style).toContain('--fx-weight:900');
  await configure(opts,false);await waitMarks(3);expect((await state())?.readingEndings).toBe(0);
 });
 it('Live Preview needs Pro, responds to changes, and leaves source mode plain',async()=>{
  const text='Reading is fast\n\n**Important note**\n\n`foo bar`\n\n```js\nconst value = 1\n```\n\n$x + y = z$';
  await configure({livePreview:true});await open('Editor.md',text,'source');
  expect((await state())?.live).toBe(0);
  await configure({livePreview:true,endingOpacity:.5},true);
  await browser.waitUntil(async()=>((await state())?.live??0)>0,{timeout:15000,timeoutMsg:'Live Preview marks are missing'});
  const marks=await browser.executeObsidian(({app,obsidian})=>{const v=app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;return Array.from(v.containerEl.querySelectorAll('.cm-content .fx')).map(el=>el.textContent);});
  expect(marks).toEqual(['Read','i','fa']);expect(await obsidianPage.read('Editor.md')).toBe(text);
  await browser.executeObsidian(({app,obsidian})=>{app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor.setValue('Reading is slow');});
  await browser.waitUntil(async()=>browser.execute(()=>Array.from(document.querySelectorAll('.workspace-leaf.mod-active .cm-content .fx')).some(el=>el.textContent==='sl')),{timeout:10000});
  await open('Source.md','Reading is fast','source',true);expect((await state())?.live).toBe(0);
  await open('Editor plain.md','---\nfixation: false\n---\nReading is fast','source');expect((await state())?.live).toBe(0);
  await configure({livePreview:true},false);expect((await state())?.live).toBe(0);
 });
 it('free Live Preview keeps rendered callouts and tables plain',async()=>{
  await configure();
  await open('Widgets.md','Plain line\n\n> [!note] Callout title\n> Reading is fast\n\n| Column |\n| --- |\n| Reading is fast |\n','source');
  await browser.waitUntil(async()=>browser.executeObsidian(({app,obsidian})=>{const el=app.workspace.getActiveViewOfType(obsidian.MarkdownView)?.containerEl;return !!el && (el.querySelector('.cm-content .callout-content')?.textContent??'').includes('Reading') && (el.querySelector('.cm-content table')?.textContent??'').includes('Reading');}),{timeout:15000,timeoutMsg:'Live Preview widgets are missing'});
  expect(await browser.executeObsidian(({app,obsidian})=>app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.containerEl.querySelectorAll('.markdown-source-view .fx').length)).toBe(0);
 });
 it('unload removes Reading marks without writing to the note',async()=>{
  await configure();await open('Unload.md','Reading is fast');await waitMarks(3);
  await browser.executeObsidian(async({app},id)=>{await (app as unknown as {plugins:{disablePlugin(id:string):Promise<void>}}).plugins.disablePlugin(id);},pluginId);await waitMarks(0);
  expect(await obsidianPage.read('Unload.md')).toBe('Reading is fast');
  await browser.executeObsidian(async({app},id)=>{await (app as unknown as {plugins:{enablePlugin(id:string):Promise<void>}}).plugins.enablePlugin(id);},pluginId);await waitMarks(3);
 });
});
