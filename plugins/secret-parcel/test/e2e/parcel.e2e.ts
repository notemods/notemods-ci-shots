import { browser, expect } from '@wdio/globals';
import type SecretParcelPlugin from '../../src/main';
import type { Payload } from '../../src/parcel';
async function seed(data: Record<string, string>): Promise<void> {
 await browser.executeObsidian(({ app }, initial) => {
  const p = (app as unknown as { plugins: { plugins: Record<string, SecretParcelPlugin> } }).plugins.plugins['secret-parcel']!;
  const values = { ...initial };
  Object.defineProperty(p, 'storage', { configurable: true, value: { listSecrets: () => Object.keys(values), getSecret: (id: string) => values[id] ?? null, setSecret: (id: string, value: string) => { values[id] = value; } } });
 }, data);
}
async function closeDialogs(): Promise<void> { await browser.executeObsidian(({ app }) => { const p = (app as unknown as { plugins: { plugins: Record<string, SecretParcelPlugin> } }).plugins.plugins['secret-parcel']!; p.closeDialogs(); }); }
const entries = [{ id: 'openai-key', value: 'sk-sample-only' }, { id: 'github-token', value: 'ghp_sample-only' }];
describe('Secret Parcel transfer', () => {
 afterEach(closeDialogs);
 it('lists IDs with hidden values and disables export before selection', async () => {
  await seed({ 'openai-key': 'sk-sample-only', 'github-token': 'ghp_sample-only', 'todoist-token': 'sample-only' });
  await browser.executeObsidianCommand('secret-parcel:export-secrets');
  await browser.waitUntil(async () => (await browser.$('.modal-title').getText()) === 'Export secrets');
  const text = await browser.$('.modal-content').getText(); expect(text).toContain('todoist-token'); expect(text).not.toContain('sk-sample-only'); expect(text).not.toContain('ghp_sample-only');
  expect(await browser.$('.modal-content button.mod-cta').isEnabled()).toBe(false);
 });
 it('exports and decrypts selected sample secrets with Web Crypto', async () => {
  await seed({ 'openai-key': 'sk-sample-only', 'github-token': 'ghp_sample-only', 'todoist-token': 'not-selected' });
  const result = await browser.executeObsidian(async ({ app }) => {
   const p = (app as unknown as { plugins: { plugins: Record<string, SecretParcelPlugin> } }).plugins.plugins['secret-parcel']!;
   const file = await p.exportSecrets(['openai-key', 'github-token'], 'correct horse', 'Secret Parcels');
   const text = await app.vault.read(file); const payload = await p.readParcel(file, 'correct horse');
   return { path: file.path, ids: payload.entries.map(e => e.id), hidden: !text.includes('sk-') && !text.includes('ghp_') };
  });
  expect(result.ids).toEqual(['openai-key', 'github-token']); expect(result.hidden).toBe(true); expect(result.path).toMatch(/\.secretparcel\.json$/);
 });
 it('imports through the file picker and passphrase dialog', async () => {
  await seed({ 'openai-key': 'sk-sample-only' });
  const path = await browser.executeObsidian(async ({ app }) => {
   const p = (app as unknown as { plugins: { plugins: Record<string, SecretParcelPlugin> } }).plugins.plugins['secret-parcel']!;
   return (await p.exportSecrets(['openai-key'], 'correct horse', 'UI Parcels')).path;
  });
  await seed({});
  await browser.executeObsidianCommand('secret-parcel:import-parcel');
  await browser.$('.prompt-input').setValue(path);
  await browser.waitUntil(async () => (await browser.$$('.suggestion-item').length) === 1);
  await browser.$('.suggestion-item').click();
  await browser.waitUntil(async () => (await browser.$('.modal-title').getText()) === 'Unlock parcel');
  await browser.$('.modal-content input[type=password]').setValue('correct horse');
  await browser.$('.modal-content button.mod-cta').click();
  await browser.waitUntil(async () => (await browser.$('.modal-title').getText()) === 'Preview import');
  expect(await browser.$('.modal-content').getText()).toContain('1 new IDs, 0 conflicting IDs');
  await browser.$('.modal-content button.mod-cta').click();
  await browser.waitUntil(async () => (await browser.$('.modal-title').getText()) === '1 written, 0 skipped, 0 failed');
 });
 it('previews conflicts unticked and reports verified writes', async () => {
  await seed({ 'github-token': 'old-sample' });
  await browser.executeObsidian(({ app }, payload) => { const p = (app as unknown as { plugins: { plugins: Record<string, SecretParcelPlugin> } }).plugins.plugins['secret-parcel']!; p.openPreview(payload as Payload); }, { entries });
  expect(await browser.$('.modal-content').getText()).toContain('1 new IDs, 1 conflicting IDs');
  expect(await browser.executeObsidian(() => document.querySelector('.modal-content .checkbox-container')?.classList.contains('is-enabled'))).toBe(false);
  await browser.$('.modal-content button.mod-cta').click();
  await browser.waitUntil(async () => (await browser.$('.modal-title').getText()).includes('1 written, 1 skipped, 0 failed'));
  const values = await browser.executeObsidian(({ app }) => { const p = (app as unknown as { plugins: { plugins: Record<string, SecretParcelPlugin> } }).plugins.plugins['secret-parcel']!; return [p.storage.getSecret('openai-key'), p.storage.getSecret('github-token')]; });
  expect(values).toEqual(['sk-sample-only', 'old-sample']);
 });
 it('overwrites only an explicitly selected conflict', async () => {
  await seed({ 'github-token': 'old-sample' });
  await browser.executeObsidian(({ app }, payload) => { const p = (app as unknown as { plugins: { plugins: Record<string, SecretParcelPlugin> } }).plugins.plugins['secret-parcel']!; p.openPreview(payload as Payload); }, { entries });
  await browser.$('.modal-content .checkbox-container').click(); await browser.$('.modal-content button.mod-cta').click();
  await browser.waitUntil(async () => (await browser.$('.modal-title').getText()).includes('2 written, 0 skipped, 0 failed'));
 });
 it('rejects wrong passphrase and changed ciphertext without writes', async () => {
  await seed({ key: 'sample' });
  const result = await browser.executeObsidian(async ({ app }) => {
   const p = (app as unknown as { plugins: { plugins: Record<string, SecretParcelPlugin> } }).plugins.plugins['secret-parcel']!;
   let writes = 0; p.storage.setSecret = () => { writes++; };
   const f = await p.exportSecrets(['key'], 'correct horse', 'Secret Parcels'); const errors: string[] = [];
   try { await p.readParcel(f, 'wrong passphrase'); } catch (e) { errors.push((e as Error).message); }
   const parcel = JSON.parse(await app.vault.read(f)) as { ct: string }; const raw = atob(parcel.ct); parcel.ct = btoa(String.fromCharCode(raw.charCodeAt(0) ^ 1) + raw.slice(1)); await app.vault.modify(f, JSON.stringify(parcel));
   try { await p.readParcel(f, 'correct horse'); } catch (e) { errors.push((e as Error).message); }
   return { errors, writes };
  }); expect(result).toEqual({ errors: ['Wrong passphrase or damaged file.', 'Wrong passphrase or damaged file.'], writes: 0 });
 });
 it('uses the public SecretStorage API in the disposable test vault', async () => {
  const result = await browser.executeObsidian(async ({ app }) => {
   const p = (app as unknown as { plugins: { plugins: Record<string, SecretParcelPlugin> } }).plugins.plugins['secret-parcel']!;
   // Remove the per-test override. These IDs and values belong to this test only.
   Reflect.deleteProperty(p, 'storage');
   app.secretStorage.setSecret('secret-parcel-e2e-source', 'sample-public-api');
   const file = await p.exportSecrets(['secret-parcel-e2e-source'], 'correct horse', 'Secret Parcels');
   const payload = await p.readParcel(file, 'correct horse');
   app.secretStorage.setSecret('secret-parcel-e2e-source', 'sample-before-import');
   p.openPreview(payload);
   const toggle = document.querySelector<HTMLElement>('.modal-content .checkbox-container'); toggle?.click();
   document.querySelector<HTMLButtonElement>('.modal-content button.mod-cta')?.click();
   const result = { value: app.secretStorage.getSecret('secret-parcel-e2e-source'), report: document.querySelector('.modal-title')?.textContent };
   app.secretStorage.setSecret('secret-parcel-e2e-source', '');
   return result;
  });
  expect(result.value).toBe('sample-public-api'); expect(result.report).toBe('1 written, 0 skipped, 0 failed');
 });
 it('refuses short passphrases before creating a file', async () => {
  await seed({ key: 'sample' });
  const result = await browser.executeObsidian(async ({ app }) => {
   const p = (app as unknown as { plugins: { plugins: Record<string, SecretParcelPlugin> } }).plugins.plugins['secret-parcel']!; const count = app.vault.getFiles().length;
   let error = ''; try { await p.exportSecrets(['key'], 'short', 'Secret Parcels'); } catch (e) { error = (e as Error).message; }
   return { reason: error, unchanged: count === app.vault.getFiles().length };
  }); expect(result).toEqual({ reason: 'Passphrase must have 8 or more characters.', unchanged: true });
 });
});
