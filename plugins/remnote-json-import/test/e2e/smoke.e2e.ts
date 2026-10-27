import { browser, expect } from '@wdio/globals';
import { pluginId, reloadPlugin } from './load';
const source = JSON.stringify({ docs: [
 { _id: 'root', key: ['Study plan'], children: ['child', 'media'] },
 { _id: 'child', parent: 'root', key: ['Practice'], value: ['Review ', { i: 'q', _id: 'root' }, { i: 'm', text: 'carefully', b: true }] },
 { _id: 'media', parent: 'root', key: ['Source image'], value: [{ content: { imageUrl: 'https://example.invalid/image.png' } }] },
] });
describe(`${pluginId} import`, function () {
 it('loads and reloads without captured errors', async () => { expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] }); });
 it('opens the command and previews pasted JSON with no account', async () => {
  await browser.executeObsidian(({ app }, id) => { const p = (app as any).plugins.plugins[id]; p.pro.signOut(); (window as any).__rniHttpCalls = 0; p.pro.opts.http = async () => { (window as any).__rniHttpCalls++; throw new Error('Unexpected request during free import'); }; }, pluginId);
  await browser.executeObsidianCommand(`${pluginId}:open-import`);
  const input = browser.$('textarea[aria-label="Source JSON"]'); await input.waitForDisplayed({ timeout: 20000 }); await input.setValue(source); await browser.$('button=Preview').click();
  await browser.waitUntil(async () => (await browser.$('.remnote-import-count').getText()) === '3 source Rems → 3 notes. 1 warnings.', { timeout: 20000 });
  expect(await browser.$('button=Create notes').isEnabled()).toBe(true); expect(await browser.$('.remnote-import-preview').getText()).toContain('media');
 });
 it('creates linked notes and a warning report through the window', async () => {
  await browser.$('button=Create notes').click();
  await browser.waitUntil(async () => (await browser.$('.remnote-import-preview').getText()).includes('Import complete: 3 notes written.'), { timeout: 20000 });
  const result = await browser.executeObsidian(async ({ app }, id) => {
   const p = (app as any).plugins.plugins[id]; const folder = app.vault.getAbstractFileByPath('RemNote import') as any;
   const files = folder.children.filter((f: any) => f.path.endsWith('.md'));
   const contents: {path: string; text: string}[] = await Promise.all(files.map(async (f: any) => ({ path: f.path as string, text: await app.vault.read(f) })));
   return { contents, hasSnapshot: p.settings.snapshot !== null, pro: p.pro.isPro() as boolean, httpCalls: (window as any).__rniHttpCalls as number };
  }, pluginId);
  expect(result.contents.length).toBe(4); expect(result.hasSnapshot).toBe(true); expect(result.pro).toBe(false); expect(result.httpCalls).toBe(0);
  const root = result.contents.find(x => x.path.includes('Study plan--'))!; const child = result.contents.find(x => x.path.includes('Practice--'))!; const report = result.contents.find(x => x.path.endsWith('Import report.md'))!;
  expect(root.text).toContain('remnote_id: root'); expect(root.text).toContain('Children:'); expect(root.text).toContain('|Practice]]'); expect(child.text).toContain('**carefully**'); expect(child.text).toContain('|Study plan]]'); expect(report.text).toContain('Written notes: 3'); expect(report.text).toContain('media:');
 });
 it('refuses an existing destination and gates Pro methods', async () => {
  const result = await browser.executeObsidian(async ({ app }, id, text) => {
   const p = (app as any).plugins.plugins[id]; const errors: string[] = [];
   for (const action of [() => p.importText(text, { folder: 'RemNote import', prefix: '', groupRoots: [] }), () => p.savePreset('P', { folder: 'Next', prefix: '', groupRoots: [] }), () => p.importText(text, { folder: 'Locked', prefix: '', groupRoots: ['root'] }), () => p.previewChanges(text)]) { try { await action(); } catch (e) { errors.push(String(e)); } }
   for (const modal of [...p.modals] as any[]) modal.close(); return { errors, locked: !!app.vault.getAbstractFileByPath('Locked') };
  }, pluginId, source);
  expect(result.errors.length).toBe(4); expect(result.errors[0]).toContain('destination exists'); expect(result.errors.slice(1).every(x => x.includes('Pro feature'))).toBe(true); expect(result.locked).toBe(false);
 });
 it('rejects malformed JSON with the import button disabled', async () => {
  await browser.executeObsidian(({ app }, id) => { (app as any).plugins.plugins[id].openImport(); }, pluginId);
  const input = browser.$('textarea[aria-label="Source JSON"]'); await input.waitForDisplayed({ timeout: 20000 }); await input.setValue('{'); await browser.$('button=Preview').click();
  await browser.waitUntil(async () => { const notices = await browser.$$('.notice'); for (const n of notices) if ((await n.getText()).includes('not valid JSON')) return true; return false; }, { timeout: 20000 });
  expect(await browser.$('button=Create notes').isEnabled()).toBe(false);
  await browser.executeObsidian(({ app }, id) => { const p = (app as any).plugins.plugins[id]; for (const modal of [...p.modals] as any[]) modal.close(); }, pluginId);
 });
 it('reads a selected JSON file through the browser File API', async () => {
  await browser.executeObsidianCommand(`${pluginId}:open-import`);
  await browser.$('input[type="file"]').waitForDisplayed({ timeout: 20000 });
  await browser.execute((text) => {
   const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
   const files = new DataTransfer(); files.items.add(new File([text], 'rem.json', { type: 'application/json' })); input.files = files.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  }, source);
  await browser.waitUntil(async () => (await browser.$('.remnote-import-count').getText()).includes('3 source Rems'), { timeout: 20000 });
  expect(await browser.$('textarea[aria-label="Source JSON"]').getValue()).toBe(source);
  expect(await browser.$('button=Create notes').isEnabled()).toBe(false);
  await browser.executeObsidian(({ app }, id) => { const p = (app as any).plugins.plugins[id]; for (const modal of [...p.modals] as any[]) modal.close(); }, pluginId);
 });
 it('uses the Sponsors answer for presets, comparison and subtree notes', async () => {
  const result = await browser.executeObsidian(async ({ app }, id, text) => {
   const p = (app as any).plugins.plugins[id]; p.pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
   app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36)); await p.pro.refreshNow();
   const changes = p.previewChanges(JSON.stringify({ docs: [{ _id: 'root', key: ['Revised'] }, { _id: 'new', key: ['New'] }] }));
   await p.savePreset('Study', { folder: 'Grouped', prefix: 'Study ', groupRoots: ['root'] }); const layout = p.applyPreset('Study'); const write = await p.importText(text, layout);
   const file = app.vault.getAbstractFileByPath(write.written[0]) as any; const content = await app.vault.read(file); p.pro.signOut(); let revoked = false; try { p.applyPreset('Study'); } catch { revoked = true; }
   return { changes, roots: layout.groupRoots as string[], written: write.written.length as number, complete: write.complete as boolean, content, revoked };
  }, pluginId, source);
  expect(result.changes).toEqual({ added: ['new'], changed: ['root'], removed: ['child', 'media'], unchanged: [] }); expect(result.roots).toEqual(['root']); expect(result.complete).toBe(true); expect(result.written).toBe(1); expect(result.content).toContain('remnote_ids:'); expect(result.content).toContain('## Rem '); expect(result.content).toContain('#Rem '); expect(result.revoked).toBe(true);
 });
 it('renders comment and math markers in source text as plain text', async () => {
  const text = await browser.executeObsidian(async ({ app, obsidian }, id) => {
   const p = (app as any).plugins.plugins[id]; const folder = 'Escaped ' + Date.now();
   const write = await p.importText(JSON.stringify({ docs: [{ _id: 'esc', key: ['Cost $5 and $10'], value: ['Draft %% hidden %% end & more'] }] }), { folder, prefix: '', groupRoots: [] });
   const file = app.vault.getAbstractFileByPath(write.written[0]) as any; const el = document.createElement('div');
   await obsidian.MarkdownRenderer.render(app, await app.vault.read(file), el, file.path, p); return el.textContent ?? '';
  }, pluginId);
  expect(text).toContain('Cost $5 and $10'); expect(text).toContain('Draft %% hidden %% end & more');
 });
});
