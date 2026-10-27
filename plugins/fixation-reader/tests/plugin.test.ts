import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import FixationReaderPlugin from '../src/main';
import { DEFAULT_SETTINGS, FixationReaderSettingTab, normalizeSettings } from '../src/settings';
import { SPONSORS, bindPro, isPro, onProChange, resetPro } from '../src/pro';
import manifest from '../manifest.json';
import vectors from './vectors/fixation-reader.json';
afterEach(() => resetPro());

describe('settings and lifetime', () => {
 it('loads defaults from an in-memory vault', async () => {
  const app = App.createConfigured__({ files: { 'a.md': 'Reading is fast' } });
  const p = new FixationReaderPlugin(app as never, manifest as never); await p.loadSettings(); expect(p.settings).toEqual(DEFAULT_SETTINGS);
 });
 it('repairs types and clamps bounds', () => {
  expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  expect(normalizeSettings({ strength:NaN, minimum:'x', color:'red;evil', weight:Infinity })).toEqual(DEFAULT_SETTINGS);
  expect(normalizeSettings({strength:9,minimum:99,weight:0,endingOpacity:0})).toMatchObject({strength:.7,minimum:30,weight:400,endingOpacity:.3});
  expect(normalizeSettings({strength:0,minimum:-1})).toMatchObject({strength:.2,minimum:1});
 });
 it(vectors.lifetimeCases[0]!.name, async () => {
  const source = 'Reading is fast';
  const app = App.createConfigured__({ files: { 'a.md': source } });
  const p = new FixationReaderPlugin(app as never,manifest as never);
  const rerender = vi.fn(); const updateOptions = vi.fn();
  p.refreshViews = () => { rerender(); updateOptions(); };
  const el = document.createElement('div'); el.textContent = source;
  p.process(el,{sourcePath:'a.md',frontmatter:null} as never); expect(el.querySelectorAll('b.fx').length).toBeGreaterThan(0);
  await p.toggle(); p.process(el,{sourcePath:'a.md',frontmatter:null} as never);
  expect({marks:el.querySelectorAll('b.fx').length,sameBytes:await app.vault.read(app.vault.getFileByPath('a.md')!) === source}).toEqual(vectors.lifetimeCases[0]!.expected);
  expect(rerender).toHaveBeenCalledOnce();
 });
 it('rejects Pro changes when the sponsor check is off', async () => {
  const app = App.createConfigured__({files:{}}); const p = new FixationReaderPlugin(app as never,manifest as never);
  const tab = new FixationReaderSettingTab(app as never,p); await tab.setControlValue('livePreview',true); expect(p.settings.livePreview).toBe(false);
 });
});
describe('sponsor checks', () => {
 it('uses the reference terms and cached state', () => {
  expect(SPONSORS).toMatchObject({clientId:'Ov23lic5UPGPZqhBlBGg',sponsorLogin:'theluckystrike',minMonthlyUsd:5,oneTimeUsd:15,oneTimeMonths:0,scope:'read:user'});
  expect(isPro()).toBe(false); const listeners = new Set<()=>void>(); let pro = false;
  bindPro({isPro:()=>pro,onChange:(cb:()=>void)=>{listeners.add(cb);return()=>listeners.delete(cb);}} as never);
  const cb = vi.fn(); const off = onProChange(cb); pro = true; for(const fn of listeners)fn(); expect(isPro()).toBe(true); expect(cb).toHaveBeenCalledOnce(); off(); resetPro(); expect(isPro()).toBe(false); expect(listeners.size).toBe(0);
 });
});
