import { afterEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { App } from 'obsidian-test-mocks/obsidian';
import SecretParcelPlugin from '../src/main';
import type { Storage } from '../src/parcel';
import manifest from '../manifest.json';
import { bindPro, resetPro, SPONSORS } from '../src/pro';
import { SponsorsManager } from '../src/license/index';
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
function memory(values: Record<string, string> = {}): Storage { const data = { ...values }; return { listSecrets: () => Object.keys(data), getSecret: id => data[id] ?? null, setSecret: (id, value) => { data[id] = value; } }; }
function plugin() { const app = App.createConfigured__({ files: { 'Welcome.md': 'Sample transfer notes' } }); return new SecretParcelPlugin(app as never, manifest as never); }
function enabled(): void { const pro = new SponsorsManager({ config: SPONSORS, http: async () => ({ status: 200, json: {} }), tokens: { get: () => null, set: () => {}, clear: () => {} }, store: { load: () => null, save: () => {} } }); vi.spyOn(pro, 'isPro').mockReturnValue(true); bindPro(pro); }
describe('audit regressions', () => {
 afterEach(() => { resetPro(); vi.useRealTimers(); });
 it('returns the new backup when an old backup cannot be removed and retries the removal later', async () => {
  enabled(); vi.useFakeTimers({ toFake: ['Date'] });
  const p = plugin(); Object.defineProperty(p, 'storage', { value: memory({ key: 'sample' }) }); p.prefs.keep = 1;
  let locked = true;
  Object.defineProperty(p.app, 'fileManager', { value: { trashFile: async (file: never) => { if (locked) throw new Error('locked'); await p.app.vault.delete(file); } } });
  vi.setSystemTime(new Date(2026, 9, 12, 12, 0)); const a = await p.exportSecrets(['key'], 'correct horse', 'Secret Parcels', true);
  vi.setSystemTime(new Date(2026, 9, 12, 12, 1)); const b = await p.exportSecrets(['key'], 'correct horse', 'Secret Parcels', true);
  expect(p.app.vault.getFileByPath(b.path)).not.toBeNull(); expect(p.app.vault.getFileByPath(a.path)).not.toBeNull();
  expect(p.prefs.backups).toEqual([a.path, b.path]);
  locked = false;
  vi.setSystemTime(new Date(2026, 9, 12, 12, 2)); const c = await p.exportSecrets(['key'], 'correct horse', 'Secret Parcels', true);
  expect(p.prefs.backups).toEqual([c.path]); expect(p.app.vault.getFileByPath(a.path)).toBeNull(); expect(p.app.vault.getFileByPath(b.path)).toBeNull();
 });
 it('removes only the chosen profile when Remove is selected twice', async () => {
  const p = plugin(); vi.spyOn(p, 'saveSettings').mockResolvedValue();
  const a = { name: 'Work', prefix: 'work-', folder: 'Secret Parcels' }; const b = { name: 'Home', prefix: 'home-', folder: 'Secret Parcels' };
  p.prefs.profiles = [a, b];
  await Promise.all([p.removeProfile(a), p.removeProfile(a)]);
  expect(p.prefs.profiles).toEqual([b]);
 });
 it('reports a keychain read failure during a comparison', async () => {
  enabled(); const p = plugin();
  Object.defineProperty(p, 'storage', { value: { listSecrets: () => { throw new Error('keychain locked'); }, getSecret: () => null, setSecret: () => {} } });
  await expect(p.compareCurrent({ entries: [{ id: 'key', value: 'sample' }] })).resolves.toBeUndefined();
 });
});
