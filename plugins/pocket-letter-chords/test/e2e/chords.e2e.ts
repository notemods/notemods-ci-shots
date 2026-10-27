import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId, reloadPlugin } from './load';
interface P {
 settings: {paused:boolean;dictionaries:{name:string;folder:string;bindings:{keys:string;text:string}[]}[]};
 flushInput():void;saveSettings():Promise<void>;
 pro:{signOut():void;opts:{http:unknown};refreshNow():Promise<void>};
}
let noteIndex = 0;
async function prepare(text=''):Promise<void>{
 const path = `Chord A ${++noteIndex}.md`;
 await obsidianPage.write(path,text);await obsidianPage.openFile(path);
 await browser.executeObsidian(async({app,obsidian},id)=>{
  const p=(app as unknown as {plugins:{plugins:Record<string,P>}}).plugins.plugins[id];p.flushInput();p.pro.signOut();p.settings={paused:false,dictionaries:[{name:'Default',folder:'',bindings:[{keys:'qw',text:'Done'}]}]};await p.saveSettings();
  const v=app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;await v.setState({mode:'source'},{history:false});v.editor.setCursor(v.editor.lastLine(),v.editor.getLine(v.editor.lastLine()).length);v.editor.focus();
 },pluginId);
 await browser.waitUntil(async()=>await browser.executeObsidian(({app,obsidian},expected)=>app.workspace.getActiveViewOfType(obsidian.MarkdownView)?.editor.getValue()===expected,text),{timeout:10000,timeoutMsg:'Note text did not load'});
 const content = await browser.$('.workspace-leaf.mod-active .markdown-source-view .cm-content');
 await content.waitForDisplayed({timeout:10000}); await content.click();
 await browser.waitUntil(async()=>browser.executeObsidian(({app,obsidian})=>{const v=app.workspace.getActiveViewOfType(obsidian.MarkdownView);v?.editor.focus();return v?.editor.hasFocus()??false;}),{timeout:10000,timeoutMsg:'Editor is not focused'});
}
type Step={key:string;type?:string;repeat?:boolean;ctrlKey?:boolean;metaKey?:boolean;altKey?:boolean;shiftKey?:boolean;isComposing?:boolean};
async function keys(steps:Step[]):Promise<{text:string;prevented:boolean[]}>{return browser.executeObsidian(({app,obsidian},list)=>{
 const v=app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;const t=document.activeElement!;
 const prevented=list.map(s=>{const e=new KeyboardEvent(s.type??'keydown',{...s,bubbles:true,cancelable:true});t.dispatchEvent(e);return e.defaultPrevented;});return{text:v.editor.getValue(),prevented};
},steps);}
const chord=(a='q',b='w'):Step[]=>[{key:a},{key:b},{key:a,type:'keyup'},{key:b,type:'keyup'}];
async function text():Promise<string>{return browser.executeObsidian(({app,obsidian})=>app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor.getValue());}
async function pro(on:boolean):Promise<void>{await browser.executeObsidian(async({app},id,value)=>{
 const p=(app as unknown as {plugins:{plugins:Record<string,P>}}).plugins.plugins[id];if(!value){p.pro.signOut();return;}
 p.pro.opts.http=async()=>({status:200,json:{data:{viewer:{login:'demo-reader'},user:{sponsorshipForViewerAsSponsor:{isActive:true,isOneTimePayment:false,tier:{name:'$5 a month',monthlyPriceInCents:500}}}}}});
 app.secretStorage.setSecret(`${id}-github-token`,'gho_'+'0'.repeat(36));await p.pro.refreshNow();
},pluginId,on);}
describe('Chord input in the real editor',function(){
 it('loads and reloads with no errors',async()=>expect(await reloadPlugin(pluginId)).toEqual({enabled:true,reloaded:true,errors:[]}));
 it('inserts once in either order',async()=>{await prepare();expect((await keys(chord())).text).toBe('Done');expect((await keys(chord('w','q'))).text).toBe('DoneDone');});
 it('keeps separate and unbound presses in order',async()=>{await prepare();expect((await keys([{key:'q'},{key:'q',type:'keyup'},{key:'w'},{key:'w',type:'keyup'}])).text).toBe('qw');expect((await keys(chord('q','x'))).text).toBe('qwqx');});
 it('flushes a single letter at timeout and keeps later normal input',async()=>{await prepare();await keys([{key:'q'}]);await browser.waitUntil(async()=>await text()==='q',{timeout:5000,timeoutMsg:'Pending q was lost'});await keys([{key:'q',type:'keyup'}]);await browser.keys('q');expect(await text()).toBe('qq');});
 it('replaces a selection and restores it with one Undo',async()=>{await prepare('old');await browser.executeObsidian(({app,obsidian})=>app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor.setSelection({line:0,ch:0},{line:0,ch:3}));expect((await keys(chord())).text).toBe('Done');await browser.executeObsidian(({app,obsidian})=>app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor.undo());expect(await text()).toBe('old');});
 it('passes composition and modifier events through',async()=>{
  await prepare();const result=await browser.executeObsidian(({app,obsidian})=>{const ed=app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor,t=document.activeElement!;t.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));const e=new KeyboardEvent('keydown',{key:'q',isComposing:true,bubbles:true,cancelable:true});t.dispatchEvent(e);ed.replaceSelection('漢字');t.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'漢字'}));return{prevented:e.defaultPrevented,text:ed.getValue()};});expect(result).toEqual({prevented:false,text:'漢字'});
  const out=await keys([{key:'c',ctrlKey:true},{key:'c',metaKey:true},{key:'q',altKey:true},{key:'q',shiftKey:true}]);expect(out.prevented).toEqual([false,false,false,false]);expect(out.text).toBe('漢字');
 });
 it('keeps pending q in A when a second tab gets focus',async()=>{await obsidianPage.write('Chord B.md','B');await prepare();const out=await browser.executeObsidian(async({app,obsidian})=>{const a=app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;a.editor.focus();document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'q',bubbles:true,cancelable:true}));await app.workspace.getLeaf('tab').openFile(app.vault.getFileByPath('Chord B.md')!);const b=app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;return{a:a.editor.getValue(),b:b.editor.getValue()};});expect(out).toEqual({a:'q',b:'B'});});
 it('keeps pause and the saved dictionary after reload',async()=>{await prepare();await browser.executeObsidianCommand(`${pluginId}:toggle-pause`);await browser.keys('qw');expect(await text()).toBe('qw');expect((await reloadPlugin(pluginId)).errors).toEqual([]);const paused=await browser.executeObsidian(({app},id)=>(app as unknown as {plugins:{plugins:Record<string,P>}}).plugins.plugins[id].settings.paused,pluginId);expect(paused).toBe(true);await browser.executeObsidianCommand(`${pluginId}:toggle-pause`);await browser.executeObsidian(({app,obsidian})=>app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor.focus());expect((await keys(chord())).text).toBe('qwDone');});
 it('does not repeat a matched chord while held',async()=>{await prepare();expect((await keys([{key:'q'},{key:'w'},{key:'q',repeat:true},{key:'w',repeat:true},{key:'q',type:'keyup'},{key:'w',type:'keyup'}])).text).toBe('Done');});
 it('passes keys through with multiple cursors',async()=>{await prepare('A\nB');await browser.executeObsidian(({app,obsidian})=>app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor.setSelections([{anchor:{line:0,ch:1},head:{line:0,ch:1}},{anchor:{line:1,ch:1},head:{line:1,ch:1}}]));expect((await keys(chord())).prevented.slice(0,2)).toEqual([false,false]);});
 it('enables folders and triples through the sponsor check',async()=>{await prepare();await pro(true);await browser.executeObsidian(({app},id)=>{const p=(app as unknown as {plugins:{plugins:Record<string,P>}}).plugins.plugins[id];p.flushInput();p.settings.dictionaries.push({name:'Root notes',folder:'Team',bindings:[{keys:'eqw',text:'Project ready'}]});p.settings.dictionaries[0].bindings=[{keys:'eqw',text:'Three'}];},pluginId);expect((await keys([{key:'q'},{key:'w'},{key:'e'},{key:'q',type:'keyup'},{key:'w',type:'keyup'},{key:'e',type:'keyup'}])).text).toBe('Three');await obsidianPage.write('Team/Review.md','');await obsidianPage.openFile('Team/Review.md');await browser.executeObsidian(async({app,obsidian})=>{const v=app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;await v.setState({mode:'source'},{history:false});v.editor.focus();});expect((await keys([{key:'q'},{key:'w'},{key:'e'},{key:'q',type:'keyup'},{key:'w',type:'keyup'},{key:'e',type:'keyup'}])).text).toBe('Project ready');await pro(false);expect((await keys(chord())).prevented.slice(0,2)).toEqual([false,false]);});
 it('shows conflict checks and locked file controls',async()=>{await prepare();await browser.executeObsidianCommand(`${pluginId}:edit-dictionary`);const area=await browser.$('textarea[aria-label="Chord rows"]');await area.waitForDisplayed();await area.setValue('[{"keys":"qw","text":"A"},{"keys":"wq","text":"B"}]');await browser.$('.pocket-letter-chords-dictionary').$('button=Save').click();await browser.waitUntil(async()=>(await browser.$('.pocket-letter-chords-error').getText()).includes('Conflict'),{timeout:5000});expect(await browser.$('.pocket-letter-chords-dictionary').$('button=Import file').isEnabled()).toBe(true);await browser.keys('Escape');});
});
