import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState, StateField } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { LanguageSupport, Language, defineLanguageFacet, languageDataProp } from '@codemirror/language';
import { parser } from '@lezer/markdown';
const data = defineLanguageFacet();
const markdown = () => new LanguageSupport(new Language(data, parser.configure({props:[languageDataProp.add({Document:data})]})));
import { editorInfoField, editorLivePreviewField } from 'obsidian';
import { editorMarks, fixationExtension } from '../src/editor';
import { DEFAULT_SETTINGS } from '../src/settings';
import { bindPro, resetPro } from '../src/pro';
import type FixationReaderPlugin from '../src/main';

vi.mock('obsidian', async (original) => ({
 ...(await original<Record<string, unknown>>()),
 editorInfoField: StateField.define({create:()=>({file:{path:'Reading.md'}}),update:v=>v}),
 editorLivePreviewField: StateField.define({create:()=>true,update:v=>v}),
}));
const views: EditorView[] = [];
afterEach(()=>{for(const v of views)v.destroy();views.length=0;resetPro();});
function fixture(text: string, pro: boolean, enabled = true, livePreview = true) {
 bindPro({isPro:()=>pro,onChange:()=>()=>undefined} as never);
 const plugin = {settings:{...DEFAULT_SETTINGS,minimum:1,livePreview},activeFor:()=>enabled} as FixationReaderPlugin;
 const state=EditorState.create({doc:text,extensions:[markdown(),editorInfoField,editorLivePreviewField]});
 const view=new EditorView({state,parent:document.body});views.push(view);
 return {plugin,view};
}
function marked(view:EditorView,plugin:FixationReaderPlugin) {
 const ranges=editorMarks(view,plugin);const words:string[]=[];
 ranges.between(0,view.state.doc.length,(from,to)=>{words.push(view.state.doc.sliceString(from,to));});return words;
}
describe('Live Preview decorations',()=>{
 it('keeps code and bold free of marks through the public parser',()=>{
  const {view,plugin}=fixture('Reading is fast\n\n**Important note**\n\n`foo bar`\n\n```js\nconst value = 1\n```',true);
  expect(marked(view,plugin)).toEqual(['Read','i','fa']);expect(view.state.doc.toString()).toContain('**Important note**');
 });
 it('leaves code unmarked when the first parse stops before the visible text',()=>{
  const head='Plain words here\n'.repeat(200000);
  const doc=head+'```js\nconst value = 1\n```\n';
  bindPro({isPro:()=>true,onChange:()=>()=>undefined} as never);
  const plugin={settings:{...DEFAULT_SETTINGS,minimum:1,livePreview:true},activeFor:()=>true} as FixationReaderPlugin;
  const state=EditorState.create({doc,extensions:[markdown(),editorInfoField,editorLivePreviewField]});
  const view={state,visibleRanges:[{from:head.length,to:doc.length}]} as unknown as EditorView;
  const words:string[]=[];editorMarks(view,plugin).between(0,doc.length,(from,to)=>{words.push(doc.slice(from,to));});
  expect(words.filter(w=>['j','con','val','co','va'].includes(w))).toEqual([]);
 });
 it('requires Pro, the option, and the note rule',()=>{
  for(const args of [[false,true,true],[true,false,true],[true,true,false]] as const){const {view,plugin}=fixture('Reading is fast',...args);expect(marked(view,plugin)).toEqual([]);}
 });
 it('responds to editor changes without inserting text',()=>{
  const {view,plugin}=fixture('Reading is fast',true);
  view.setState(EditorState.create({doc:'Reading is fast',extensions:[markdown(),editorInfoField,editorLivePreviewField,fixationExtension(plugin)]}));
  view.dispatch({changes:{from:11,to:15,insert:'slow'}});
  expect(marked(view,plugin)).toEqual(['Read','i','sl']);expect(view.state.doc.toString()).toBe('Reading is slow');
 });
});
