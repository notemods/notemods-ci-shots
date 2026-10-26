import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import VimwikiImportPlugin from '../src/main';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import { planImport, cleanPath, combinedReport } from '../src/importer';
import { bindPro, resetPro, isPro, SPONSORS } from '../src/pro';
import manifest from '../manifest.json';
afterEach(()=>resetPro());
function setup() {
 const app=App.createConfigured__({files:{'Wiki/a.wiki':'= A =\n[[b]]','Wiki/b.wiki':'B'}});
 const plugin=new VimwikiImportPlugin(app as never,manifest as never);
 return {app,plugin};
}
describe('import safety',()=>{
 it('imports into a new folder with mapped links and keeps sources',async()=>{
  const {app,plugin}=setup();const plan=await plugin.preview('Wiki','Notes');
  const result=await plugin.importPlan(plan);
  expect(result.created).toEqual(['Notes/a.md','Notes/b.md']);
  expect(await app.vault.read(app.vault.getFileByPath('Notes/a.md')!)).toBe('# A\n[[Notes/b|b]]');
  expect(await app.vault.read(app.vault.getFileByPath('Wiki/a.wiki')!)).toBe('= A =\n[[b]]');
  expect(result.report).toBe('Notes/Vimwiki report.md');
 });
 it('skips a changed source and preserves a new conflict',async()=>{
  const {app,plugin}=setup();const plan=await plugin.preview('Wiki','Notes');
  await app.vault.modify(app.vault.getFileByPath('Wiki/a.wiki')!,'Changed');
  await app.vault.createFolder('Notes');await app.vault.create('Notes/b.md','Keep');
  const result=await plugin.importPlan(plan);
  expect(result.created).toEqual([]);expect(result.issues.map(i=>i.reason)).toEqual(['Source changed or missing; page skipped.','Output conflict; page skipped.']);
  expect(await app.vault.read(app.vault.getFileByPath('Notes/b.md')!)).toBe('Keep');
 });
 it('preview writes nothing',async()=>{const {app,plugin}=setup();await plugin.preview('Wiki','Notes');expect(app.vault.getFiles().map(f=>f.path).sort()).toEqual(['Wiki/a.wiki','Wiki/b.wiki']);});
 it('rejects an existing destination',async()=>{const {app,plugin}=setup();await app.vault.createFolder('Notes');await expect(plugin.preview('Wiki','Notes')).rejects.toThrow('new destination');});
 it('guards diary preview and import after sign out',async()=>{
  const {plugin}=setup();await expect(plugin.preview('Wiki','Notes','Daily')).rejects.toThrow('Pro');
  await expect(plugin.importPlan(planImport([{path:'Wiki/diary/2026-10-14.wiki',text:'Day'}],{source:'Wiki',destination:'Notes',diary:'Daily'}))).rejects.toThrow('Pro');
 });
 it('guards the combined report',async()=>{await expect(setup().plugin.writeCombined()).rejects.toThrow('Pro');});
 it('writes a Pro diary and stores local reports',async()=>{
  bindPro({isPro:()=>true,onChange:()=>()=>undefined} as never);
  const {app,plugin}=setup();await app.vault.createFolder('Wiki/diary');await app.vault.create('Wiki/diary/2026-10-14.wiki','Day');
  const result=await plugin.importPlan(await plugin.preview('Wiki','Notes','Daily'));
  expect(result.created).toContain('Daily/2026-10-14.md');expect(plugin.records.length).toBe(1);
  expect(await plugin.writeCombined()).toBe('Vimwiki report.md');
 });
 it('reports a failed page write and continues',async()=>{
  const {app,plugin}=setup();const plan=await plugin.preview('Wiki','Notes');const original=app.vault.create.bind(app.vault);
  vi.spyOn(app.vault,'create').mockImplementation((path,text)=>path==='Notes/a.md' ? Promise.reject(new Error('disk full')) : original(path,text));
  const result=await plugin.importPlan(plan);expect(result.created).toEqual(['Notes/b.md']);expect(result.issues[0]?.reason).toContain('disk full');
 });
 it('does not replace an existing report',async()=>{
  const {app,plugin}=setup();await app.vault.createFolder('Notes');await app.vault.create('Notes/Vimwiki report.md','Keep');
  expect(await plugin.uniqueReport('Notes','New')).toBe('Notes/Vimwiki report 2.md');
  expect(await app.vault.read(app.vault.getFileByPath('Notes/Vimwiki report.md')!)).toBe('Keep');
 });
});
describe('paths and settings',()=>{
 it('refuses paths above the vault and overlapping folders',()=>{
  expect(()=>cleanPath('../outside')).toThrow();
  expect(()=>planImport([],{source:'Wiki',destination:'Wiki/New'})).toThrow();
  expect(()=>planImport([],{source:'Wiki',destination:'Notes',diary:'Wiki/diary'})).toThrow();
 });
 it('normalizes paths and repairs saved settings',async()=>{
  expect(cleanPath('Wiki/folder/../a')).toBe('Wiki/a');
  expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);expect(normalizeSettings({source:5 as never})).toEqual(DEFAULT_SETTINGS);
  const {plugin}=setup();await plugin.loadSettings();expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
 });
 it('combines unresolved targets from two import records',()=>{
  const text=combinedReport(['One','Two'].map(source=>({source,destination:'Notes',issues:[{source:source+'/a.wiki',target:'missing',reason:'Unresolved link; target retained.'},{source,target:'-',reason:'Checkbox'}]})));
  expect(text).toContain('One/a.wiki');expect(text).toContain('Two/a.wiki');expect(text).not.toContain('Checkbox');
 });
 it('drops malformed saved report entries',async()=>{
  const {plugin}=setup();await plugin.saveData({records:[null,{source:'Wiki',destination:'Notes',issues:[null]}]});await plugin.loadSettings();expect(plugin.records).toEqual([]);
 });
 it('keeps sponsor terms and follows manager state',()=>{
  expect(SPONSORS).toMatchObject({clientId:'Ov23lic5UPGPZqhBlBGg',minMonthlyUsd:5,oneTimeUsd:15});
  expect(isPro()).toBe(false);bindPro({isPro:()=>true,onChange:()=>()=>undefined} as never);expect(isPro()).toBe(true);resetPro();expect(isPro()).toBe(false);
 });
});
