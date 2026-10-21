import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId, reloadPlugin } from './load';
import type TaskFormatBridgePlugin from '../../src/main';

const source = '- [ ] Prepare release ⏫ 📅 2026-10-21\n- [x] Check build ✅ 2026-10-18';
const target = '- [ ] Prepare release [priority:: high] [due:: 2026-10-21]\n- [x] Check build [completion:: 2026-10-18]';
async function editorText(): Promise<string> { return browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.getValue() ?? ''); }
async function closeModals(): Promise<void> { await browser.execute(() => { document.querySelectorAll<HTMLButtonElement>('.modal .setting-item-control button').forEach((b) => { if (b.textContent === 'Cancel') b.click(); }); }); }
async function clickApply(): Promise<void> {
 const found = await browser.execute(() => { const b = [...document.querySelectorAll<HTMLButtonElement>('.modal button')].find((b) => b.textContent === 'Apply conversion'); b?.click(); return !!b; });
 expect(found).toBe(true);
}
async function setPro(value: boolean): Promise<void> {
 await browser.executeObsidian(async ({ app }, id, on) => {
  const p = (app as unknown as { plugins: { plugins: Record<string, TaskFormatBridgePlugin> } }).plugins.plugins[id]!;
  if (!on) { p.pro!.signOut(); return; }
  (p.pro as unknown as { opts: { http: unknown } }).opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
  app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36)); await p.pro!.refreshNow();
 }, pluginId, value);
}
describe('Task Format Bridge real editor', function () {
 beforeEach(async () => { await closeModals(); await setPro(false); });
 afterEach(async () => { await closeModals(); await setPro(false); });
 it('loads and reloads without console errors', async () => { expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] }); });
 it('previews for free, applies to the editor, and supports undo', async () => {
  await obsidianPage.write('Bridge.md', source); await obsidianPage.openFile('Bridge.md');
  await browser.executeObsidianCommand(`${pluginId}:preview-dataview`);
  expect(await editorText()).toBe(source);
  expect(await browser.$('.task-format-bridge-summary').getText()).toContain('2 changed lines');
  await clickApply(); expect(await editorText()).toBe(target);
  await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.undo());
  expect(await editorText()).toBe(source);
 });
 it('converts the reverse direction and preserves a source block ID', async () => {
  await obsidianPage.write('Reverse.md', '- [/] Draft [due:: 2026-10-21] ^draft'); await obsidianPage.openFile('Reverse.md');
  await browser.executeObsidianCommand(`${pluginId}:preview-emoji`); await clickApply();
  expect(await editorText()).toBe('- [/] Draft 📅 2026-10-21 ^draft');
 });
 it('does not apply an expired preview', async () => {
  await obsidianPage.write('Expired.md', source); await obsidianPage.openFile('Expired.md');
  await browser.executeObsidianCommand(`${pluginId}:preview-dataview`);
  await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.replaceRange('New text\n', { line: 0, ch: 0 }));
  const changed = await editorText(); await clickApply(); expect(await editorText()).toBe(changed);
  expect(await browser.$('.task-format-bridge-summary').isExisting()).toBe(true);
 });
 it('keeps invalid and duplicate dates while converting a valid task', async () => {
  await obsidianPage.write('Skipped.md', '- [ ] Bad 📅 2026-02-30\n- [ ] Duplicate 📅 2026-10-20 [due:: 2026-10-21]\n- [ ] Good 📅 2026-10-21'); await obsidianPage.openFile('Skipped.md');
  await browser.executeObsidianCommand(`${pluginId}:preview-dataview`);
  expect(await browser.$('.task-format-bridge-summary').getText()).toContain('2 skipped lines');
  await clickApply(); expect(await editorText()).toContain('- [ ] Bad 📅 2026-02-30\n- [ ] Duplicate 📅 2026-10-20 [due:: 2026-10-21]\n- [ ] Good [due:: 2026-10-21]');
 });
 it('guards the report and scans read-only with a test Pro entitlement', async () => {
  const free = await browser.executeObsidian(async ({ app }, id) => {
   const p = (app as unknown as { plugins: { plugins: Record<string, TaskFormatBridgePlugin> } }).plugins.plugins[id]!;
   try { await p.scan('', 'dataview'); return false; } catch { return true; }
  }, pluginId); expect(free).toBe(true);
  await setPro(true);
  await obsidianPage.write('Report/One.md', '- [ ] Report 📅 2026-10-21');
  const result = await browser.executeObsidian(async ({ app }, id) => {
   const p = (app as unknown as { plugins: { plugins: Record<string, TaskFormatBridgePlugin> } }).plugins.plugins[id]!;
   const file = app.vault.getFileByPath('Report/One.md')!; const before = await app.vault.read(file);
   const report = await p.scan('Report', 'dataview'); const after = await app.vault.read(file);
   return { report, unchanged: before === after };
  }, pluginId);
  expect(result).toEqual({ report: { rows: [{ path: 'Report/One.md', changes: 1, warnings: [] }], limited: false }, unchanged: true });
  await browser.executeObsidianCommand(`${pluginId}:folder-report`);
  expect(await browser.$('.modal-title').getText()).toBe('Folder migration report');
 });

 it('keeps a task inside a list-contained code fence unchanged', async () => {
  const source = '- ```md\n  - [ ] Code 📅 2026-10-21\n  ```\n- [ ] Real 📅 2026-10-21';
  await obsidianPage.write('Nested-code.md', source); await obsidianPage.openFile('Nested-code.md');
  await browser.executeObsidianCommand(`${pluginId}:preview-dataview`); await clickApply();
  expect(await editorText()).toBe('- ```md\n  - [ ] Code 📅 2026-10-21\n  ```\n- [ ] Real [due:: 2026-10-21]');
 });

 it('converts emoji aliases, nested subtasks and a tagged task in the editor', async () => {
  const source = '- [ ] Parent 📅 2024-01-01\n\t- [ ] Tab child 📆 2024-01-02\n    - [ ] Space child 🗓 2024-01-03\n\t\t- [ ] Grandchild ⌛ 2024-01-04\n- [ ] Scheduled ⏳ 2024-01-05\n- [ ] Tagged 📅 2024-01-06 #tag\n- [ ] Use `%%` 📅 2024-01-07\n- [ ] Comment %%hidden%% 📅 2024-01-08\n- [ ] After comment 📅 2024-01-09';
  const target = '- [ ] Parent [due:: 2024-01-01]\n\t- [ ] Tab child [due:: 2024-01-02]\n    - [ ] Space child [due:: 2024-01-03]\n\t\t- [ ] Grandchild [scheduled:: 2024-01-04]\n- [ ] Scheduled [scheduled:: 2024-01-05]\n- [ ] Tagged [due:: 2024-01-06] #tag\n- [ ] Use `%%` [due:: 2024-01-07]\n- [ ] Comment %%hidden%% 📅 2024-01-08\n- [ ] After comment [due:: 2024-01-09]';
  await obsidianPage.write('Review-fixes.md', source); await obsidianPage.openFile('Review-fixes.md');
  await browser.executeObsidianCommand(`${pluginId}:preview-dataview`);
  expect(await browser.$('.task-format-bridge-summary').getText()).toContain('8 changed lines · 1 skipped lines');
  await clickApply(); expect(await editorText()).toBe(target);
  await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.undo());
  expect(await editorText()).toBe(source);
 });

 it('scans the root path through the report controls', async () => {
  await obsidianPage.write('Root-regression.md', '- [ ] Root 📆 2024-01-01 #tag');
  await setPro(true);
  await browser.executeObsidianCommand(`${pluginId}:folder-report`);
  await browser.$('.modal input[type=text]').setValue('/');
  await browser.$('button=Scan folder').click();
  await browser.waitUntil(async () => (await browser.$('.task-format-bridge-report').getText()).includes('Root-regression.md'), { timeout: 10_000 });
  expect(await browser.$('.task-format-bridge-report').getText()).toContain('1 convertible lines · 0 skipped lines');
 });

});
