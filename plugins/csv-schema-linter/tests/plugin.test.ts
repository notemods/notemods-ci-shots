import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import Plugin from '../src/main';
import manifest from '../manifest.json';
import { bindPro, isPro, resetPro, SPONSORS } from '../src/pro';
import { normalizeSettings } from '../src/settings';
import { previewFixes } from '../src/checker';

afterEach(() => resetPro());
function plugin() {
 const csv = '\uFEFFid,name\r\n001, Ada \r\n';
 const schema = JSON.stringify({ columns: { id: { type: 'string' }, name: { trim: true } } });
 const app = App.createConfigured__({ files: { 'data.csv': csv, 'data.csv.schema.json': schema } });
 const owner = new Plugin(app as never, manifest as never);
 vi.spyOn(owner, 'showResults').mockResolvedValue();
 return { owner, app, csv, schema };
}
function pro(on = true) { bindPro({ isPro: () => on, onChange: () => () => undefined } as never); }
describe('source safety and output', () => {
 it('runs twice and creates reports with new names without changing sources', async () => {
  const { owner, app, csv, schema } = plugin();
  await owner.runCheck('data.csv'); await owner.runCheck('data.csv');
  const one = await owner.writeReport(); const two = await owner.writeReport();
  expect(one.path).not.toBe(two.path);
  expect(await app.vault.read(app.vault.getFileByPath('data.csv')!)).toBe(csv);
  expect(await app.vault.read(app.vault.getFileByPath('data.csv.schema.json')!)).toBe(schema);
  expect(await app.vault.read(one as never)).toContain('0 errors');
 });
 it('does not create a report for invalid input', async () => {
  const { owner, app } = plugin();
  await app.vault.create('bad.csv', 'id,id\nA,A');
  await app.vault.create('bad.csv.schema.json', '{"columns":{}}');
  await expect(owner.runCheck('bad.csv')).rejects.toThrow('duplicate');
  await expect(owner.writeReport()).rejects.toThrow('first');
 });
 it('rejects oversized files before vault reads', async () => {
  const { owner, app } = plugin();
  const file = app.vault.getFileByPath('data.csv')!;
  file.stat.size = 5 * 1024 * 1024 + 1;
  const read = vi.spyOn(app.vault, 'read');
  await expect(owner.runCheck('data.csv')).rejects.toThrow('5 MiB'); expect(read).not.toHaveBeenCalled();
 });
 it('shows a clear error for absent adjacent rules', async () => {
  const { owner, app } = plugin(); await app.vault.create('other.csv', 'name\nAda');
  await expect(owner.runCheck('other.csv')).rejects.toThrow('other.csv.schema.json');
 });
 it('refuses fixes if the source changed after preview', async () => {
  pro(); const { owner, app } = plugin(); await owner.runCheck('data.csv');
  const item = owner.latest[0]!; const preview = previewFixes(item.csv, item.schema);
  await app.vault.modify(app.vault.getFileByPath('data.csv')!, 'id,name\n001,Changed');
  await expect(owner.writeFixed(item, preview)).rejects.toThrow('changed');
  expect(app.vault.getFileByPath('data fixed 1.csv')).toBeNull();
 });
 it('writes a separate CSV and preserves original values such as 001', async () => {
  pro(); const { owner, app, csv } = plugin(); await owner.runCheck('data.csv');
  const item = owner.latest[0]!; const file = await owner.writeFixed(item, previewFixes(item.csv, item.schema));
  expect(await app.vault.read(file! as never)).toContain('"001","Ada"');
  expect(await app.vault.read(app.vault.getFileByPath('data.csv')!)).toBe(csv);
 });
});
describe('Pro gates', () => {
 it('defaults to free with the fixed Sponsors terms', () => { expect(isPro()).toBe(false); expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', minMonthlyUsd: 5, oneTimeUsd: 15, sponsorLogin: 'theluckystrike' }); });
 it('blocks batch, saving rules, preview, and new CSV writes when Pro is off', async () => {
  const { owner, app } = plugin(); await owner.runCheck('data.csv');
  await owner.saveRuleSet('People'); expect(Object.keys(owner.settings.ruleSets)).toEqual([]);
  const item = owner.latest[0]!;
  expect(await owner.writeFixed(item, previewFixes(item.csv, item.schema))).toBeNull();
  const read = vi.spyOn(owner, 'readCheck'); await owner.runBatch(['data.csv'], 'People'); expect(read).not.toHaveBeenCalled();
  await owner.openPreview(); expect(app.vault.getFileByPath('data fixed 1.csv')).toBeNull();
 });
 it('saves and reuses rules for chosen files with no adjacent schema', async () => {
  pro(); const { owner, app } = plugin(); vi.spyOn(owner, 'saveData').mockResolvedValue();
  await owner.runCheck('data.csv'); await owner.saveRuleSet('People');
  await app.vault.create('second.csv', 'id,name\n002,Bob');
  await owner.runBatch(['data.csv', 'second.csv'], 'People');
  expect(owner.latest.map(i => i.path)).toEqual(['data.csv', 'second.csv']);
  await expect(owner.saveRuleSet('People')).rejects.toThrow('exists');
  await expect(owner.runBatch([], 'People')).rejects.toThrow('1 to 20');
 });
 it('loads valid rules and drops malformed saved data', () => {
  expect(normalizeSettings(null).ruleSets).toEqual({});
  expect(normalizeSettings({ ruleSets: { Bad: '{}', Good: '{"columns":{}}', Other: 1 } }).ruleSets).toEqual({ Good: '{"columns":{}}' });
 });
});
