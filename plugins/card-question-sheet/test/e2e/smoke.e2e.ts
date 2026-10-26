import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { PDFDocument } from 'pdf-lib';
import { pluginId, reloadPlugin } from './load';
import type Tool from '../../src/main';
import type { Parsed } from '../../src/cards';
async function openNote(path: string, text: string): Promise<void> {
 await obsidianPage.write(path, text); await obsidianPage.openFile(path);
 await browser.waitUntil(async () => browser.executeObsidian(({ app, obsidian }, target, content) => {
  const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
  return view?.file?.path === target && view.editor.getValue() === content;
 }, path, text), { timeout: 15000, timeoutMsg: 'The source editor is not ready' });
 await browser.executeObsidianCommand(`${pluginId}:export-current`);
 await browser.waitUntil(async () => (await browser.$('.cqs-preview')).isDisplayed(), { timeout: 10000 });
}
async function parsed(): Promise<Parsed> {
 return browser.executeObsidian(({ app }, id) => (app as unknown as { plugins: { plugins: Record<string, Tool> } }).plugins.plugins[id]!.preview!.parsed, pluginId);
}
async function closePreview(): Promise<void> {
 await browser.executeObsidian(({ app }, id) => { (app as unknown as { plugins: { plugins: Record<string, Tool> } }).plugins.plugins[id]?.preview?.close(); }, pluginId);
}
async function setPro(on: boolean): Promise<void> {
 await browser.executeObsidian(async ({ app }, id, enabled) => {
  interface Manager { opts: { http: unknown }; refreshNow(): Promise<unknown>; signOut(): void }
  const p = (app as unknown as { plugins: { plugins: Record<string, { pro: Manager }> } }).plugins.plugins[id]!;
  p.pro.signOut(); p.pro.opts.http = () => { throw new Error('A free operation tried to use the network'); };
  if (!enabled) return;
  p.pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
  app.secretStorage.setSecret(id + '-github-token', 'gho_' + '0'.repeat(36)); await p.pro.refreshNow();
 }, pluginId, on);
}
async function pdfBytes(path: string): Promise<Uint8Array> {
 const result = await browser.executeObsidian(async ({ app, obsidian }, name) => {
  const file = app.vault.getAbstractFileByPath(name); if (!(file instanceof obsidian.TFile)) throw new Error('No PDF at ' + name);
  return Array.from(new Uint8Array(await app.vault.readBinary(file)));
 }, path); return Uint8Array.from(result);
}
async function save(path: string): Promise<void> {
 await browser.$('.cqs-preview button.mod-cta').click();
 await browser.waitUntil(async () => browser.executeObsidian(({ app }, name) => !!app.vault.getAbstractFileByPath(name), path), { timeout: 15000 });
}
describe(`${pluginId} in Obsidian`, function () {
 before(async () => { await setPro(false); });
 afterEach(async () => { await closePreview(); await setPro(false); });
 it('loads and reloads with no console errors', async () => { expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] }); await setPro(false); });
 it('saves a free two page PDF without a network check and keeps the source intact', async () => {
  await openNote('Core.md', 'Capital of France::Paris\n2+2::4');
  expect((await parsed()).cards.map((c) => [c.question, c.answer])).toEqual([['Capital of France', 'Paris'], ['2+2', '4']]);
  await save('Core questions.pdf'); expect((await PDFDocument.load(await pdfBytes('Core questions.pdf'))).getPageCount()).toBe(2);
  expect(await obsidianPage.read('Core.md')).toBe('Capital of France::Paris\n2+2::4');
 });
 it('reads unsaved editor changes and reversed cards', async () => {
  await openNote('Editor.md', 'Old::Answer'); await closePreview();
  await browser.executeObsidian(({ app, obsidian }) => { app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor.setValue('cat:::chat'); });
  await browser.executeObsidianCommand(`${pluginId}:export-current`);
  expect((await parsed()).cards.map((c) => [c.question, c.answer])).toEqual([['cat', 'chat'], ['chat', 'cat']]);
 });
 it('excludes frontmatter and backtick and tilde code', async () => {
  await openNote('Excluded.md', '---\nfield: Q::A\n---\n```text\nHidden::Answer\n```\n~~~text\nHidden2::Answer2\n~~~\nVisible::Yes');
  expect((await parsed()).cards.map((c) => c.question)).toEqual(['Visible']);
 });
 it('shows selection and saves only selected cards', async () => {
  await openNote('Selection.md', 'A::1\nB::2\nC::3'); await browser.$('[aria-label="Select card 2"]').click();
  expect(await browser.$('.cqs-count').getText()).toBe('3 cards found • 2 selected');
  const chosen = await browser.executeObsidian(({ app }, id) => {
   const m = (app as unknown as { plugins: { plugins: Record<string, Tool> } }).plugins.plugins[id]!.preview!;
   return m.parsed.cards.filter((_, i) => m.selected.has(i)).map((c) => [c.question, c.answer]);
  }, pluginId); expect(chosen).toEqual([['A', '1'], ['C', '3']]);
  await save('Selection questions.pdf'); expect((await PDFDocument.load(await pdfBytes('Selection questions.pdf'))).getPageCount()).toBe(2);
 });
 it('reports unsupported forms with line numbers and blocks export', async () => {
  await openNote('Unsupported.md', 'Photo::![[x.png]]\nGap::{{c1::x}}\nSum::$x+y$');
  expect((await parsed()).unsupported.map((c) => c.line)).toEqual([1, 2, 3]);
  expect(await browser.$('.cqs-preview button.mod-cta').isEnabled()).toBe(false);
  expect(await browser.executeObsidian(({ app }) => !!app.vault.getAbstractFileByPath('Unsupported questions.pdf'))).toBe(false);
 });
 it('exports supported Unicode and blocks the missing Han glyph', async () => {
  await openNote('Unicode.md', 'Café — α::Ж'); await save('Unicode questions.pdf');
  expect((await PDFDocument.load(await pdfBytes('Unicode questions.pdf'))).getPageCount()).toBe(2);
  await openNote('Han.md', 'Han::汉'); expect(await browser.$('.cqs-error').getText()).toContain('汉');
  expect(await browser.$('.cqs-preview button.mod-cta').isEnabled()).toBe(false);
 });
 it('uses a new output name and cancellation creates no extra file', async () => {
  await browser.executeObsidian(async ({ app }) => { await app.vault.createBinary('Cards questions.pdf', new TextEncoder().encode('old file').buffer); });
  await openNote('Cards.md', 'A::1'); await save('Cards questions 1.pdf');
  expect(new TextDecoder().decode(await pdfBytes('Cards questions.pdf'))).toBe('old file');
  await openNote('Cards.md', 'A::1');
  await browser.executeObsidian(({ app }, id) => {
   const modal = (app as unknown as { plugins: { plugins: Record<string, Tool> } }).plugins.plugins[id]!.preview!;
   [...modal.contentEl.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!.click();
  }, pluginId);
  expect(await browser.executeObsidian(({ app }) => !!app.vault.getAbstractFileByPath('Cards questions 2.pdf'))).toBe(false);
  expect(await obsidianPage.read('Cards.md')).toBe('A::1');
 });
 it('keeps folder and preset operations behind Pro', async () => {
  const result = await browser.executeObsidian(async ({ app }, id) => {
   const p = (app as unknown as { plugins: { plugins: Record<string, Tool> } }).plugins.plugins[id]!;
   await p.openFolder('', ''); return { saved: await p.savePreset('Blocked', { margin: 60, textSize: 14, answerSpace: 72 }), preview: !!p.preview };
  }, pluginId); expect(result).toEqual({ saved: false, preview: false });
 });
 it('filters folder notes by one cached tag and saves page settings with Pro', async () => {
  await obsidianPage.write('Study/Tagged.md', '---\ntags: [science]\n---\nPlanet::Mars');
  await obsidianPage.write('Study/Sub/Tagged.md', '#science\nMoon::Luna');
  await obsidianPage.write('Study/Other.md', '#language\ncat:::chat');
  await obsidianPage.write('Study2/Wrong.md', '#science\nWrong::Outside');
  await browser.waitUntil(async () => browser.executeObsidian(({ app, obsidian }) => {
   return ['Study/Sub/Tagged.md', 'Study/Tagged.md'].every((path) => {
    const f = app.vault.getAbstractFileByPath(path); if (!(f instanceof obsidian.TFile)) return false;
    const c = app.metadataCache.getFileCache(f); return !!c && (obsidian.getAllTags(c) ?? []).includes('#science');
   });
  }), { timeout: 20000, timeoutMsg: 'The tag cache is not ready' });
  await setPro(true);
  const result = await browser.executeObsidian(async ({ app }, id) => {
   const p = (app as unknown as { plugins: { plugins: Record<string, Tool> } }).plugins.plugins[id]!;
   const saved = await p.savePreset('Exam', { margin: 60, textSize: 14, answerSpace: 72 }); await p.openFolder('Study', '#science');
   return { saved, preset: p.settings.presets.find((v) => v.name === 'Exam'), cards: p.preview!.parsed.cards.map((c) => c.question) };
  }, pluginId);
  expect(result).toEqual({ saved: true, preset: { name: 'Exam', page: { margin: 60, textSize: 14, answerSpace: 72 } }, cards: ['Moon', 'Planet'] });
  await save('Study/Folder questions.pdf'); expect((await PDFDocument.load(await pdfBytes('Study/Folder questions.pdf'))).getPageCount()).toBe(2);
 });
});
