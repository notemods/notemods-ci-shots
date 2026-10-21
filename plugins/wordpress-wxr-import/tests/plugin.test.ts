import { describe, expect, it, afterEach, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import { readFileSync } from 'node:fs';
import Plugin from '../src/main';
import { ImportModal } from '../src/modal';
import { normalizeSettings } from '../src/settings';
import { SPONSORS, bindPro, resetPro, isPro } from '../src/pro';
import { markdown, noteText, planImport, readSnapshot, writePlan } from '../src/model';
import { parseWxr, MAX_BYTES } from '../src/parser';
import manifest from '../manifest.json';
const xml = readFileSync('tests/fixtures/three-records.xml', 'utf8');
afterEach(() => resetPro());
function plugin(files: Record<string, string> = {}) { const app = App.createConfigured__({ files }); return new Plugin(app as never, manifest as never); }
function pro(on: boolean) { bindPro({ isPro: () => on, onChange: () => () => undefined } as never); }
describe('writes and properties', () => {
 it('creates notes, index, report and snapshot through the vault', async () => {
  const p = plugin(); const plan = await p.importXml(xml, 'Import');
  expect(plan.noteCount).toBe(3);
  const file = p.app.vault.getAbstractFileByPath('Import/Field journal-11.md');
  expect(file).not.toBeNull();
  const content = await p.app.vault.read(file as never);
  expect(content).toContain('source_id:'); expect(content).toContain('Research'); expect(content).toContain('field-notes'); expect(content).toContain('## Approved comments'); expect(content).toContain('A helpful comment');
  expect(await p.app.vault.read(p.app.vault.getAbstractFileByPath('Import/_report.md') as never)).toContain('nav\\_menu\\_item: 1');
  const snapshot = readSnapshot(await p.app.vault.read(p.app.vault.getAbstractFileByPath('Import/_source.json') as never)); expect(snapshot.records).toHaveLength(3);
  expect(plan.files[0]?.times).toEqual({ ctime: Date.parse('2024-12-17T10:00:00Z'), mtime: Date.parse('2024-12-18T11:00:00Z') });
 });
 it('enables the button component after preview and imports through its click handler', async () => {
  const p = plugin(); const m = new ImportModal(p, false, () => undefined); m.onOpen();
  const bytes = new TextEncoder().encode(xml);
  await m.selectFile({name:'sample.xml',size:bytes.length,arrayBuffer:async()=>bytes.buffer} as File);
  const button = [...m.contentEl.querySelectorAll<HTMLButtonElement>('button')].find((b)=>b.textContent === 'Create notes')!;
  expect(button.disabled).toBe(false); button.click();
  await vi.waitFor(()=>expect(m.contentEl.querySelector('.wxr-status')?.textContent).toContain('Created 3 notes'));
  expect(p.app.vault.getAbstractFileByPath('WordPress import/Field journal-11.md')).not.toBeNull();m.close();
 });
 it('does not change existing notes on a repeated import', async () => {
  const p = plugin({ 'Import/keep.md': 'Keep this text' });
  await expect(p.importXml(xml, 'Import')).rejects.toThrow('folder exists');
  expect(await p.app.vault.read(p.app.vault.getAbstractFileByPath('Import/keep.md') as never)).toBe('Keep this text');
  expect(p.app.vault.getAbstractFileByPath('Import/Field journal-11.md')).toBeNull();
 });
 it('does not call create for invalid XML, folder or duplicate IDs', async () => {
  const p = plugin(); const create = vi.spyOn(p.app.vault, 'create');
  for (const [source, folder] of [['<rss>', 'Import'], [xml, '../Import'], [xml.replace('<wp:post_id>12', '<wp:post_id>11'), 'Import']]) await expect(p.importXml(source!, folder!)).rejects.toThrow();
  expect(create).not.toHaveBeenCalled();
 });
 it('stops if the destination appears while the parent folder is created', async () => {
  let destinationExists = false;
  const create = vi.fn();
  const createFolder = vi.fn(async (path:string) => {
   if (path === 'Parent') { destinationExists = true; return {} as never; }
   throw new Error('Folder already exists');
  });
  const vault = { getAbstractFileByPath:(path:string) => path === 'Parent/Import' && destinationExists ? {} as never : null, createFolder, create };
  await expect(writePlan(vault,planImport(xml,'Parent/Import'))).rejects.toThrow('already exists');expect(create).not.toHaveBeenCalled();
 });
 it('uses identical plans without platform specific code and keeps the XML string', () => {
  const source = xml; expect(planImport(source, 'Import')).toEqual(planImport(source, 'Import')); expect(source).toBe(xml); expect(manifest.isDesktopOnly).toBe(false);
 });
 it('omits invalid zero dates from write options but keeps properties', () => {
  const plan = planImport(xml.replaceAll('2024-12-17 10:00:00','0000-00-00 00:00:00'), 'Import');
  expect(plan.files[0]?.times?.ctime).toBeUndefined(); expect(plan.files[0]?.content).toContain('0000-00-00');
 });
 it('makes no fetch or request when converting remote media or shortcodes', () => {
  const fetch = vi.spyOn(window, 'fetch');
  const text = markdown('<p><img src="https://example.org/x.jpg" alt="Photo"></p><p>[gallery ids="1"]</p><script>alert(1)</script><iframe src="https://example.org"></iframe>');
  expect(text).toContain('[Photo](https://example.org/x.jpg)'); expect(text).not.toContain('!['); expect(text).toContain('[gallery ids="1"]'); expect(text).not.toContain('alert'); expect(text).not.toContain('<iframe'); expect(fetch).not.toHaveBeenCalled();
 });
 it('removes unsafe link schemes', () => expect(markdown('<p><a href="javascript:alert(1)">Unsafe</a></p>')).toBe('Unsafe'));
 it('rejects oversized input before parsing', () => expect(() => parseWxr('x'.repeat(MAX_BYTES + 1))).toThrow('20 MiB'));
 it('rejects duplicate attributes and incomplete tags', () => {
  expect(() => parseWxr('<rss a="1" a="2"/>')).toThrow('duplicate attributes');
  expect(() => parseWxr('<rss><')).toThrow('incomplete document');
 });
 it('reports a write failure and preserves earlier files', async () => {
  const p = plugin({ 'keep.md': 'Original' }); const create = vi.spyOn(p.app.vault,'create').mockRejectedValue(new Error('disk full'));
  await expect(writePlan(p.app.vault,planImport(xml,'Import'))).rejects.toThrow('disk full');
  expect(create).toHaveBeenCalledTimes(1); expect(await p.app.vault.read(p.app.vault.getAbstractFileByPath('keep.md') as never)).toBe('Original');
 });
});
describe('Pro access and comparison', () => {
 it('starts without Pro and uses the reference sponsor values', () => {
  expect(isPro()).toBe(false); expect(SPONSORS).toMatchObject({ clientId:'Ov23lic5UPGPZqhBlBGg', minMonthlyUsd:5, oneTimeUsd:15, sponsorLogin:'theluckystrike', oneTimeMonths:0, scope:'read:user' });
 });
 it('blocks profiles, mapping and comparison without Pro', async () => {
  const p = plugin(); await expect(p.saveProfile({ name:'Blog',folder:'Import',mapping:{} })).rejects.toThrow('Pro');
  await expect(p.importXml(xml,'Import',{author:'writer'})).rejects.toThrow('Pro'); await expect(p.importXml(xml,'Review',{},'Import')).rejects.toThrow('Pro');
  expect(p.app.vault.getAbstractFileByPath('Import')).toBeNull();
 });
 it('saves a profile and replaces it by name when Pro is on', async () => {
  const p = plugin(); pro(true); await p.saveProfile({name:'Blog',folder:'Import',mapping:{author:'writer'}}); await p.saveProfile({name:'Blog',folder:'New import',mapping:{title:'heading'}});
  expect(p.settings.profiles).toHaveLength(1); expect(p.settings.profiles[0]?.mapping.title).toBe('heading');
  pro(false); await expect(p.saveProfile({name:'Blog',folder:'Other',mapping:{}})).rejects.toThrow('Pro');
 });
 it('creates changed and added notes in a review folder and lists removed IDs', async () => {
  const p = plugin(); await p.importXml(xml,'Original'); pro(true);
  const updated = xml.replace('Our first field visit.','Our second field visit.').replace(/<item><title>Contact[\s\S]*?<\/item>/,'').replace('<wp:post_id>12</wp:post_id>','<wp:post_id>99</wp:post_id>');
  const plan = await p.importXml(updated,'Review',{},'Original');
  expect(plan.changes).toEqual([{id:'11',state:'changed'},{id:'99',state:'added'},{id:'12',state:'removed'},{id:'13',state:'removed'}]);
  expect(plan.noteCount).toBe(2); expect(await p.app.vault.read(p.app.vault.getAbstractFileByPath('Original/Field journal-11.md') as never)).toContain('first field');
  expect(await p.app.vault.read(p.app.vault.getAbstractFileByPath('Review/Field journal-11.md') as never)).toContain('second field');
 });
 it('unchanged source produces only the review index, report and snapshot', async () => {
  const p = plugin(); await p.importXml(xml,'Original'); pro(true); const plan = await p.importXml(xml,'Review',{},'Original'); expect(plan.noteCount).toBe(0); expect(plan.changes).toEqual([]);
 });
 it('rejects a missing or invalid baseline', async () => {
  const p = plugin(); pro(true); await expect(p.prepare(xml,'Review',{},'Missing')).rejects.toThrow('snapshot'); expect(() => readSnapshot('{"version":1,"records":[{}]}')).toThrow('invalid record');
 });
 it('maps property names and keeps source IDs fixed', () => {
  const r = parseWxr(xml).records[0]!; const text = noteText(r,{author:'writer'}); expect(text).toContain('writer: Writer'); expect(text).toContain('source_id:'); expect(text).not.toContain('\nauthor:');
 });
 it('repairs malformed saved data and drops unsafe profiles', async () => {
  const p = plugin(); await p.loadSettings(); expect(p.settings).toEqual({profiles:[]}); expect(normalizeSettings({profiles:'bad' as never})).toEqual({profiles:[]}); expect(normalizeSettings({profiles:[{name:'bad',folder:'../x',mapping:{}}]})).toEqual({profiles:[]});
 });
});
