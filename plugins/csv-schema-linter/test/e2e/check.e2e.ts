import { browser, expect } from '@wdio/globals';
import type CsvSchemaLinterPlugin from '../../src/main';
import { pluginId } from './load';
describe('CSV checks in the app', () => {
 it('checks row errors, exports two reports, and leaves source bytes unchanged', async () => {
  const state = await browser.executeObsidian(async ({ app }, id) => {
   const owner = (app as unknown as { plugins: { plugins: Record<string, CsvSchemaLinterPlugin> } }).plugins.plugins[id]!;
   owner.pro!.signOut();
   const path = 'CSV Rule Check/people.csv';
   const source = app.vault.getFileByPath(path)!;
   const schema = app.vault.getFileByPath(`${path}.schema.json`)!;
   const before = await app.vault.read(source); const rules = await app.vault.read(schema);
   await owner.runCheck(path); await owner.runCheck(path);
   const one = await owner.writeReport(); const two = await owner.writeReport();
   return { sameCSV: before === await app.vault.read(source), sameRules: rules === await app.vault.read(schema), distinct: one.path !== two.path, errors: owner.latest[0]!.result.errors, text: document.querySelector('.csv-rule-results')?.textContent ?? '', report: await app.vault.read(one) };
  }, pluginId);
  expect(state.sameCSV).toBe(true); expect(state.sameRules).toBe(true); expect(state.distinct).toBe(true);
  expect(state.errors).toContainEqual({ row: 3, column: 'age', rule: 'type number', value: 'xx' });
  expect(state.errors).toContainEqual({ row: 3, column: 'name', rule: 'required', value: '' });
  expect(state.text).toContain('Logical row'); expect(state.text).toContain('Failed rule'); expect(state.report).toContain('age');
 });
 it('uses logical records for quoted commas and line breaks', async () => {
  const state = await browser.executeObsidian(async ({ app }, id) => {
   const owner = (app as unknown as { plugins: { plugins: Record<string, CsvSchemaLinterPlugin> } }).plugins.plugins[id]!;
   await owner.runCheck('CSV Rule Check/quoted.csv');
   return { rows: owner.latest[0]!.result.rows, errors: owner.latest[0]!.result.errors };
  }, pluginId);
  expect(state.rows[0]![1]).toBe('a,b\nsecond line');
  expect(state.errors).toEqual([{ row: 3, column: 'age', rule: 'type number', value: 'xx' }]);
 });
 it('rejects duplicate headers and malformed schemas with clear messages', async () => {
  const errors = await browser.executeObsidian(async ({ app }, id) => {
   const owner = (app as unknown as { plugins: { plugins: Record<string, CsvSchemaLinterPlugin> } }).plugins.plugins[id]!;
   const errors: string[] = [];
   for (const path of ['CSV Rule Check/duplicate.csv', 'CSV Rule Check/bad.csv']) try { await owner.runCheck(path); } catch (e) { errors.push(String(e)); }
   return errors;
  }, pluginId);
  expect(errors[0]).toContain('duplicate headers'); expect(errors[1]).toContain('not valid JSON');
 });
 it('blocks Pro methods when signed out', async () => {
  const state = await browser.executeObsidian(async ({ app }, id) => {
   const owner = (app as unknown as { plugins: { plugins: Record<string, CsvSchemaLinterPlugin> } }).plugins.plugins[id]!;
   owner.pro!.signOut(); await owner.runCheck('CSV Rule Check/people.csv');
   const count = Object.keys(owner.settings.ruleSets).length;
   await owner.saveRuleSet('Blocked'); await owner.openPreview();
   return { same: count === Object.keys(owner.settings.ruleSets).length, preview: !!document.querySelector('.modal-title')?.textContent?.includes('Fix preview'), pro: owner.pro!.isPro() };
  }, pluginId);
  expect(state).toEqual({ same: true, preview: false, pro: false });
 });
 it('checks Pro preview and batch with a local Sponsors response', async () => {
  const state = await browser.executeObsidian(async ({ app }, id) => {
   const owner = (app as unknown as { plugins: { plugins: Record<string, CsvSchemaLinterPlugin> } }).plugins.plugins[id]!;
   const pro = owner.pro!;
   const options = pro as unknown as { opts: { http: () => Promise<unknown> } };
   options.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
   app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
   await pro.refreshNow();
   try {
    await owner.runCheck('CSV Rule Check/fix.csv'); await owner.openPreview();
    const title = document.querySelector('.modal-title')?.textContent;
    const button = [...document.querySelectorAll<HTMLButtonElement>('.modal-content button')].find(b => b.textContent === 'Write new CSV (pro)');
    button?.click();
    return { pro: pro.isPro(), title, button: !!button };
   } finally { /* The next test checks the completed write before sign out. */ }
  }, pluginId);
  expect(state.pro).toBe(true); expect(state.title).toBe('Fix preview (pro)'); expect(state.button).toBe(true);
  await browser.waitUntil(async () => browser.executeObsidian(({ app }) => !!app.vault.getFileByPath('CSV Rule Check/fix fixed 1.csv')), { timeout: 10000 });
  const batch = await browser.executeObsidian(async ({ app }, id) => {
   const owner = (app as unknown as { plugins: { plugins: Record<string, CsvSchemaLinterPlugin> } }).plugins.plugins[id]!;
   await owner.runCheck('CSV Rule Check/fix.csv');
   await owner.saveRuleSet('Demo');
   await owner.runBatch(['CSV Rule Check/fix.csv', 'CSV Rule Check/fix fixed 1.csv'], 'Demo');
   const state = { count: owner.latest.length, fixed: owner.latest[1]!.result.total, firstID: owner.latest[1]!.result.rows[0]![0] };
   owner.pro!.signOut(); return state;
  }, pluginId);
  expect(batch).toEqual({ count: 2, fixed: 0, firstID: '001' });
 });
});
