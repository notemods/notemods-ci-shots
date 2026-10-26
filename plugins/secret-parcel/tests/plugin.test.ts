import { afterEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { App } from 'obsidian-test-mocks/obsidian';
import SecretParcelPlugin from '../src/main';
import { normalizeSettings } from '../src/settings';
import { validatePayload, writePayload, preview, decrypt, type Storage } from '../src/parcel';
import manifest from '../manifest.json';
import { bindPro, resetPro, SPONSORS, isPro } from '../src/pro';
import { SponsorsManager } from '../src/license/index';
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
function memory(values: Record<string, string> = {}): Storage { const data = { ...values }; return { listSecrets: () => Object.keys(data), getSecret: id => data[id] ?? null, setSecret: (id, value) => { data[id] = value; } }; }
function plugin() { const app = App.createConfigured__({ files: { 'Welcome.md': 'Sample transfer notes' } }); return new SecretParcelPlugin(app as never, manifest as never); }
describe('transfer safeguards', () => {
 it('repairs retention and saved settings', () => { expect(normalizeSettings({ keep: -9 }).keep).toBe(1); expect(normalizeSettings({ keep: NaN }).keep).toBe(5); expect(normalizeSettings(null).profiles).toEqual([]); });
 it('validates before the first write', () => { const storage = memory(); const set = vi.spyOn(storage, 'setSecret'); expect(() => writePayload({ entries: [{ id: 'valid', value: 'x' }, { id: 'Bad ID!', value: 'x' }] }, storage, new Set())).toThrow('Invalid entry 2'); expect(set).not.toHaveBeenCalled(); });
 it('keeps conflicting value and rechecks a new conflict after preview', () => { const storage = memory(); const p = { entries: [{ id: 'key', value: 'new' }] }; expect(preview(p, storage).newIds).toEqual(['key']); storage.setSecret('key', 'old'); expect(writePayload(p, storage, new Set()).skipped).toEqual(['key']); expect(storage.getSecret('key')).toBe('old'); });
 it('reports thrown writes and failed read-back without values', () => { const storage = memory(); storage.setSecret = id => { if (id === 'fail') throw new Error('sample secret'); }; expect(writePayload({ entries: [{ id: 'fail', value: 'sensitive' }, { id: 'mismatch', value: 'sensitive' }] }, storage, new Set())).toEqual({ written: [], skipped: [], failed: ['fail', 'mismatch'] }); });
 it('exports selected IDs only and writes one encrypted file', async () => { const p = plugin(); const storage = memory({ 'openai-key': 'sk-original', 'other-key': 'private-other' }); Object.defineProperty(p, 'storage', { value: storage }); const get = vi.spyOn(storage, 'getSecret'); const file = await p.exportSecrets(['openai-key'], 'correct horse', 'Secret Parcels'); const text = await p.app.vault.read(file); expect(file.path).toMatch(/^Secret Parcels\/secrets-\d{4}-\d{2}-\d{2}-\d{4}\.secretparcel\.json$/); expect(get.mock.calls).toEqual([['openai-key']]); expect(text).not.toContain('sk-original'); expect(await decrypt(text, 'correct horse')).toEqual({ entries: [{ id: 'openai-key', value: 'sk-original' }] }); });
 it('does not overwrite an existing parcel in the same minute', async () => { const p = plugin(); Object.defineProperty(p, 'storage', { value: memory({ key: 'sample' }) }); const a = await p.exportSecrets(['key'], 'correct horse', 'Secret Parcels'); const b = await p.exportSecrets(['key'], 'correct horse', 'Secret Parcels'); expect(a.path).not.toBe(b.path); });
 it('refuses an empty selection without a file', async () => { const p = plugin(); Object.defineProperty(p, 'storage', { value: memory() }); await expect(p.exportSecrets([], 'correct horse', 'Secret Parcels')).rejects.toThrow('Select at least'); expect(p.app.vault.getFiles()).toHaveLength(1); });
 it('refuses a short passphrase without a file', async () => { const p = plugin(); Object.defineProperty(p, 'storage', { value: memory({ key: 'sample' }) }); await expect(p.exportSecrets(['key'], 'short', 'Secret Parcels')).rejects.toThrow('Passphrase'); expect(p.app.vault.getFiles()).toHaveLength(1); });
 it('rejects non-text values', () => { expect(() => validatePayload({ entries: [{ id: 'key', value: 1 }] })).toThrow('value must be text'); });
});

describe('Pro boundaries and backup retention', () => {
 afterEach(resetPro);
 function enabled(): void { const pro = new SponsorsManager({ config: SPONSORS, http: async () => ({ status: 200, json: {} }), tokens: { get: () => null, set: () => {}, clear: () => {} }, store: { load: () => null, save: () => {} } }); vi.spyOn(pro, 'isPro').mockReturnValue(true); bindPro(pro); }
 it('uses the reference sponsorship values', () => { expect(SPONSORS).toEqual({ clientId: 'Ov23lic5UPGPZqhBlBGg', sponsorLogin: 'theluckystrike', minMonthlyUsd: 5, oneTimeUsd: 15, oneTimeMonths: 0, scope: 'read:user' }); });
 it('leaves Pro off without a manager', () => { resetPro(); expect(isPro()).toBe(false); });
 it('refuses backups without Pro before writing a file', async () => { const p = plugin(); Object.defineProperty(p, 'storage', { value: memory({ key: 'sample' }) }); await expect(p.exportSecrets(['key'], 'correct horse', 'Secret Parcels', true)).rejects.toThrow('Pro is required'); expect(p.app.vault.getFiles()).toHaveLength(1); });
 it('keeps the last tracked backups and preserves ordinary exports', async () => {
  enabled(); const p = plugin(); Object.defineProperty(p, 'storage', { value: memory({ key: 'sample' }) });
  p.prefs.keep = 1;
  const remove = vi.fn(async (file) => p.app.vault.delete(file));
  Object.defineProperty(p.app, 'fileManager', { value: { trashFile: remove } });
  const ordinary = await p.exportSecrets(['key'], 'correct horse', 'Secret Parcels');
  const a = await p.exportSecrets(['key'], 'correct horse', 'Secret Parcels', true);
  const b = await p.exportSecrets(['key'], 'correct horse', 'Secret Parcels', true);
  expect(p.prefs.backups).toEqual([b.path]); expect(remove).toHaveBeenCalledTimes(1); expect(p.app.vault.getFileByPath(a.path)).toBeNull(); expect(p.app.vault.getFileByPath(ordinary.path)).not.toBeNull();
 });
 it('does not remove existing backups after encryption fails', async () => {
  enabled(); const p = plugin(); Object.defineProperty(p, 'storage', { value: memory({ key: 'sample' }) });
  const first = await p.exportSecrets(['key'], 'correct horse', 'Secret Parcels', true);
  await expect(p.exportSecrets(['key'], 'short', 'Secret Parcels', true)).rejects.toThrow('Passphrase');
  expect(p.prefs.backups).toEqual([first.path]); expect(p.app.vault.getFileByPath(first.path)).not.toBeNull();
 });
});

it('reports an earlier invalid entry before the entry count limit', () => { const entries = [{ id: 'Bad ID!', value: 'sample' }, ...Array.from({ length: 500 }, (_, i) => ({ id: `key-${i}`, value: 'sample' }))]; expect(() => validatePayload({ entries })).toThrow('Invalid entry 1'); });

describe('backup retention with a reused path', () => {
 afterEach(() => { resetPro(); vi.useRealTimers(); });
 it('keeps the new backup when it reuses the path of a deleted tracked backup', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 12, 12, 0));
  const pro = new SponsorsManager({ config: SPONSORS, http: async () => ({ status: 200, json: {} }), tokens: { get: () => null, set: () => {}, clear: () => {} }, store: { load: () => null, save: () => {} } }); vi.spyOn(pro, 'isPro').mockReturnValue(true); bindPro(pro);
  const p = plugin(); Object.defineProperty(p, 'storage', { value: memory({ key: 'sample' }) });
  p.prefs.keep = 1;
  Object.defineProperty(p.app, 'fileManager', { value: { trashFile: async (file: never) => p.app.vault.delete(file) } });
  const a = await p.exportSecrets(['key'], 'correct horse', 'Secret Parcels', true);
  await p.app.vault.delete(a);
  const b = await p.exportSecrets(['key'], 'correct horse', 'Secret Parcels', true);
  expect(b.path).toBe(a.path);
  expect(p.app.vault.getFileByPath(b.path)).not.toBeNull();
  expect(p.prefs.backups).toEqual([b.path]);
 });
});
