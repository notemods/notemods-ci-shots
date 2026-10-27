import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId, reloadPlugin } from './load';
interface View {
 path: string; expression: string; savedName: string; batchPaths: string; error: string; result: unknown;
 contentEl: HTMLElement;
 draw(): void; run(batch?: boolean): Promise<void>; selectSaved(name: string): void;
 exportResult(kind: 'csv' | 'md', name: string): Promise<string | null>;
 copy(): Promise<void>;
}
interface Product {
 views: Set<View>;
 settings: { saved: { name: string; path: string; expression: string }[] };
 saveQuery(q: { name: string; path: string; expression: string }): Promise<void>;
 openView(): Promise<View>;
 pro: { opts: { http: unknown }; refreshNow(): Promise<void>; signOut(): void };
}
async function run(path: string, expression: string) {
 return browser.executeObsidian(async ({ app }, id, path, expression) => {
  const p = (app as unknown as { plugins: { plugins: Record<string, Product> } }).plugins.plugins[id]!;
  const v = await p.openView(); v.path = path; v.expression = expression; v.draw(); await v.run();
  return { result: v.result, message: v.error, text: v.contentEl.textContent, rows: v.contentEl.querySelectorAll('tbody tr').length, columns: Array.from(v.contentEl.querySelectorAll('th')).map((e) => e.textContent), markup: v.contentEl.querySelectorAll('img, script').length };
 }, pluginId, path, expression);
}
async function setPro(on: boolean) {
 await browser.executeObsidian(async ({ app }, id, on) => {
  const p = (app as unknown as { plugins: { plugins: Record<string, Product> } }).plugins.plugins[id]!;
  if (!on) { p.pro.signOut(); return; }
  p.pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
  app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
  await p.pro.refreshNow();
 }, pluginId, on);
}
describe(`${pluginId} in the app`, function () {
 before(async function () {
  await setPro(false);
  await obsidianPage.write('people.json', '{"rows":[{"name":"Ada","age":20},{"name":"Lin","age":30}]}');
  await obsidianPage.write('names.jsonl', '{"name":"Ada"}\n{"name":"Lin"}');
 });
 it('loads and reloads without captured errors', async function () {
  expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] });
 });
 it('opens from the command and the Run query button draws a table', async function () {
  await browser.executeObsidianCommand(`${pluginId}:open-query`);
  await browser.waitUntil(async () => browser.executeObsidian(({ app }, id) => [...(app as unknown as { plugins: { plugins: Record<string, Product> } }).plugins.plugins[id]!.views].some((v) => v.contentEl.isConnected), pluginId), { timeout: 10000 });
  await browser.executeObsidian(({ app }, id) => {
   const p = (app as unknown as { plugins: { plugins: Record<string, Product> } }).plugins.plugins[id]!;
   const v = [...p.views].find((v) => v.contentEl.isConnected)!;
   v.path = 'people.json'; v.expression = 'rows[*].{person:name,years:age}'; v.draw();
   const b = Array.from(v.contentEl.querySelectorAll('button')).find((b) => b.textContent === 'Run query')!; b.click();
  }, pluginId);
  await browser.waitUntil(async () => (await browser.$$('.local-json-output tbody tr').length) === 2, { timeout: 10000 });
  expect(await browser.$('.local-json-output').getText()).toContain('Lin');
 });
 it('filters names, shows scalars and reads JSONL', async function () {
  expect((await run('people.json', 'rows[?age > `25`].name')).result).toEqual(['Lin']);
  expect((await run('people.json', 'length(rows)')).result).toBe(2);
  expect((await run('names.jsonl', '[*].name')).result).toEqual(['Ada', 'Lin']);
 });
 it('restores saved Adults after plugin reload', async function () {
  await browser.executeObsidian(async ({ app }, id) => {
   const p = (app as unknown as { plugins: { plugins: Record<string, Product> } }).plugins.plugins[id]!;
   await p.saveQuery({ name: 'Adults', path: 'people.json', expression: 'rows[?age > `25`].name' });
  }, pluginId);
  expect((await reloadPlugin(pluginId)).errors).toEqual([]);
  const saved = await browser.executeObsidian(async ({ app }, id) => {
   const p = (app as unknown as { plugins: { plugins: Record<string, Product> } }).plugins.plugins[id]!;
   const v = await p.openView(); v.selectSaved('Adults'); await v.run();
   return { path: v.path, expression: v.expression, result: v.result };
  }, pluginId);
  expect(saved).toEqual({ path: 'people.json', expression: 'rows[?age > `25`].name', result: ['Lin'] });
 });
 it('shows errors and does not create reports for invalid input', async function () {
  await obsidianPage.write('bad.jsonl', '{"name":"Ada"}\nwrong');
  expect((await run('bad.jsonl', '@')).message).toContain('line 2');
  expect((await run('absent.json', '@')).message).toContain('absent');
  const bad = await run('people.json', 'rows['); expect(bad.message).not.toBe(''); expect(bad.rows).toBe(0);
  const report = await browser.executeObsidian(async ({ app }, id) => {
   const p = (app as unknown as { plugins: { plugins: Record<string, Product> } }).plugins.plugins[id]!;
   const v = await p.openView();
   const result = await v.exportResult('csv', 'Bad query report');
   return { result, exists: !!app.vault.getFileByPath('Bad query report.csv') };
  }, pluginId);
  expect(report).toEqual({ result: null, exists: false });
 });
 it('renders HTML as text and bounds 1000 rows', async function () {
  await obsidianPage.write('markup.json', '[{"value":"<img src=x onerror=alert(1)><script>bad</script>"}]');
  const markup = await run('markup.json', '@'); expect(markup.markup).toBe(0); expect(markup.text).toContain('<img');
  await obsidianPage.write('many.json', JSON.stringify(Array.from({ length: 1000 }, (_, id) => ({ id }))));
  const many = await run('many.json', '@'); expect(many.rows).toBe(500); expect(many.text).toContain('500 of 1000');
 });
 it('rejects oversized input and unsafe integers', async function () {
  await obsidianPage.write('huge.json', ' '.repeat(5 * 1024 * 1024 + 1));
  expect((await run('huge.json', '@')).message).toContain('5 MiB');
  await obsidianPage.write('unsafe.json', '{"n":9007199254740993}');
  expect((await run('unsafe.json', 'n')).message).toContain('safe range');
 });
 it('free reports and batch queries need Pro', async function () {
  await setPro(false); await run('people.json', 'rows');
  const free = await browser.executeObsidian(async ({ app }, id) => {
   const p = (app as unknown as { plugins: { plugins: Record<string, Product> } }).plugins.plugins[id]!;
   const v = await p.openView(); const report = await v.exportResult('csv', 'Free report');
   v.selectSaved('Adults'); v.batchPaths = 'people.json\nnames.jsonl'; await v.run(true);
   return { report, message: v.error, exists: !!app.vault.getFileByPath('Free report.csv') };
  }, pluginId);
  expect(free.report).toBeNull(); expect(free.message).toContain('Pro'); expect(free.exists).toBe(false);
 });
 it('Pro combines a saved query, writes reports and keeps an existing file', async function () {
  await setPro(true);
  await obsidianPage.write('second.json', '{"rows":[{"name":"Sam","age":40}]}');
  const result = await browser.executeObsidian(async ({ app }, id) => {
   const p = (app as unknown as { plugins: { plugins: Record<string, Product> } }).plugins.plugins[id]!;
   await p.saveQuery({ name: 'People', path: 'people.json', expression: 'rows[*].{name:name,age:age}' });
   const v = await p.openView(); v.selectSaved('People'); v.batchPaths = 'people.json\nsecond.json'; await v.run(true);
   const value = v.result;
   const csvPath = await v.exportResult('csv', 'People report'); const mdPath = await v.exportResult('md', 'People report');
   const csvFile = app.vault.getFileByPath(csvPath!); const mdFile = app.vault.getFileByPath(mdPath!);
   const csv = await app.vault.read(csvFile!); const md = await app.vault.read(mdFile!);
   const duplicate = await v.exportResult('csv', 'People report');
   await app.vault.create('empty-objects.json', '[{},{}]');
   v.path = 'empty-objects.json'; v.expression = '@'; v.draw(); await v.run();
   const emptyPath = await v.exportResult('csv', 'Empty object report');
   const emptyFile = app.vault.getFileByPath(emptyPath!);
   return { value, csv, md, duplicate, kept: await app.vault.read(csvFile!), empty: await app.vault.read(emptyFile!) };
  }, pluginId);
  expect(result.value).toEqual([{ name: 'Ada', age: 20 }, { name: 'Lin', age: 30 }, { name: 'Sam', age: 40 }]);
  expect(result.csv).toContain('"Sam","40"'); expect(result.md).toContain('| Sam | 40 |');
  expect(result.duplicate).toBeNull(); expect(result.kept).toBe(result.csv);
  expect(result.empty).toBe('"result"\r\n"{}"\r\n"{}"\r\n');
  await setPro(false);
 });
});
