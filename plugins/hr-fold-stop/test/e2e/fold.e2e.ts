import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId, reloadPlugin } from './load';
import type { EditorView } from '@codemirror/view';
import type { HrFoldStopSettings } from '../../src/settings';

interface TestPlugin {
 settings: HrFoldStopSettings;
 editorViews: Set<EditorView>;
 pro: { signOut(): void; opts: { http: unknown }; refreshNow(): Promise<void> };
 saveSettings(): Promise<void>;
 noteOverrideFor(path: string): boolean | undefined;
}
const TEXT = '# Head\nBody line\n\n---\nTail line\n# End\nEnd body\n';

async function configure(saved: Partial<HrFoldStopSettings> = {}, paid = false): Promise<void> {
 await browser.executeObsidian(async ({ app }, id, settings, pro) => {
  const p = (app as unknown as { plugins: { plugins: Record<string, TestPlugin> } }).plugins.plugins[id]!;
  p.pro.signOut();
  p.settings = { enabled: true, endMarkers: true, folders: [], overrideProperty: 'fold-stop', ...settings };
  await p.saveSettings();
  if (pro) {
   p.pro.opts.http = () => Promise.resolve({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
   app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
   await p.pro.refreshNow();
  }
 }, pluginId, saved, paid);
}

let noteCount = 0;
async function open(text = TEXT, source = true, path = `Fold Stop ${++noteCount}.md`): Promise<void> {
 await obsidianPage.write(path, text);
 await obsidianPage.openFile(path);
 await browser.executeObsidian(async ({ app }, file, sourceMode) => {
  await app.workspace.getMostRecentLeaf()!.setViewState({ type: 'markdown', state: { file, mode: 'source', source: sourceMode } });
 }, path, source);
 await browser.waitUntil(async () => browser.executeObsidian(({ app }, id, doc, file) => {
  const p = (app as unknown as { plugins: { plugins: Record<string, TestPlugin> } }).plugins.plugins[id];
  return app.workspace.getActiveFile()?.path === file && app.workspace.activeEditor?.editor?.getValue() === doc && !!p && [...p.editorViews].some(v => v.state.doc.toString() === doc);
 }, pluginId, text, path), { timeout: 15000 });
 await browser.executeObsidian(({ app }) => app.workspace.activeEditor!.editor!.exec('unfoldAll'));
}
async function fold(line = 0): Promise<void> {
 await browser.executeObsidian(({ app }, number) => {
  app.workspace.activeEditor!.editor!.setCursor({ line: number, ch: 0 });
  app.workspace.activeEditor!.editor!.exec('toggleFold');
 }, line);
}
async function snapshot() {
 return browser.executeObsidian(({ app }, id) => {
  const p = (app as unknown as { plugins: { plugins: Record<string, TestPlugin> } }).plugins.plugins[id];
  if (!p) return null;
  const { foldedRanges, foldable } = require('@codemirror/language') as typeof import('@codemirror/language');
  const { editorInfoField, editorLivePreviewField } = require('obsidian') as typeof import('obsidian');
  const view = [...p.editorViews].find(v => v.state.field(editorInfoField, false)?.editor === app.workspace.activeEditor?.editor && v.dom.isConnected);
  if (!view) return null;
  const hidden: string[] = [];
  const positions: number[][] = [];
  for (let cursor = foldedRanges(view.state).iter(); cursor.value; cursor.next()) { hidden.push(view.state.doc.sliceString(cursor.from, cursor.to)); positions.push([cursor.from, cursor.to]); }
  return { doc: view.state.doc.toString(), hidden, positions, visible: view.contentDOM.textContent ?? '', source: !view.state.field(editorLivePreviewField, false), foldable: foldable(view.state, view.state.doc.line(1).from, view.state.doc.line(1).to), viewCount: p.editorViews.size };
 }, pluginId);
}
async function waitFold() {
 let state: Awaited<ReturnType<typeof snapshot>> = null;
 try { await browser.waitUntil(async () => { state = await snapshot(); return !!state?.hidden.length; }, { timeout: 10000, timeoutMsg: 'Native fold did not create a range' }); } catch (error) { console.log('Fold state', JSON.stringify(state)); throw error; }
 return state! as NonNullable<Awaited<ReturnType<typeof snapshot>>>;
}
async function expectCustom(text = TEXT, line = 0, source = true, path?: string): Promise<void> {
 await open(text, source, path);
 await fold(line);
 const state = await waitFold();
 expect(state.hidden).toHaveLength(1);
 expect(state.hidden[0]).toContain('Body');
 expect(state.hidden[0]).not.toContain('Tail');
 expect(state.visible).toContain('Tail');
 expect(state.doc).toBe(text);
 expect(state.source).toBe(source);
}

describe(`${pluginId} native folding`, function () {
 beforeEach(async () => configure());
 after(async () => configure());
 it('reloads without console errors', async () => expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] }));
 for (const source of [true, false]) {
  it(`stops before a rule in ${source ? 'Source' : 'Live Preview'} mode`, async () => expectCustom(TEXT, 0, source));
 }
 it('folds child headings with their parent', async () => expectCustom('# Head\nBody\n## Child\nChild body\n\n***\nTail\n'));
 it('stops at an equal heading before a later rule', async () => {
  await open('# Head\nBody\n# Next\nNext body\n\n---\nTail\n'); await fold();
  const state = await waitFold();
  expect(state.hidden[0]).toContain('Body'); expect(state.hidden[0]).not.toContain('Next'); expect(state.visible).toContain('Next');
 });
 for (const [label, text, line] of [
  ['fenced code', '# Head\n```text\n---\n```\nBody\n\n___\nTail\n', 0],
  ['YAML', '---\ntags: [test]\n---\n# Head\nBody\n\n***\nTail\n', 3],
  ['Setext', '# Head\nSetext child\n------------\nBody\n\n---\nTail\n', 0],
  ['indented code', '# Head\n\n    ---\n\nBody\n\n---\nTail\n', 0],
 ] as const) it(`ignores rule-like text in ${label}`, async () => expectCustom(text, line));
 it('expands stored folds on setting change and then uses stock folding', async () => {
  await expectCustom(); await configure({ enabled: false }); expect((await snapshot())?.hidden).toEqual([]); await fold();
  const state = await waitFold(); expect(state.hidden[0]).toContain('Tail'); expect(state.hidden[0]).toContain('---'); expect(state.doc).toBe(TEXT);
 });
 it('restores normal folding until settings change', async () => {
  await expectCustom(); await browser.executeObsidianCommand(`${pluginId}:restore-normal-folding`);
  expect((await snapshot())?.hidden).toEqual([]); await fold(); expect((await waitFold()).hidden[0]).toContain('Tail');
  await configure(); await fold(); expect((await waitFold()).hidden[0]).not.toContain('Tail');
 });
 it('ignores paid folder rules without a sponsor', async () => {
  await configure({ folders: [{ folder: 'Archive', enabled: false }] }); await expectCustom(TEXT, 0, true, 'Archive/Free.md');
 });
 it('uses the longest Pro folder path and Boolean note override', async () => {
  await configure({ folders: [{ folder: 'Archive', enabled: false }, { folder: 'Archive/Active', enabled: true }] }, true);
  await expectCustom(TEXT, 0, true, 'Archive/Active/A.md'); await open(TEXT, true, 'Archive/B.md'); await fold(); expect((await waitFold()).hidden[0]).toContain('Tail');
  await open('---\nfold-stop: true\n---\n' + TEXT, true, 'Archive/Override.md');
  await browser.waitUntil(async () => browser.executeObsidian(({ app }, id) => (app as unknown as { plugins: { plugins: Record<string, TestPlugin> } }).plugins.plugins[id]!.noteOverrideFor('Archive/Override.md') === true, pluginId), { timeout: 15000 });
  await fold(3); expect((await waitFold()).hidden[0]).not.toContain('Tail');
  await browser.executeObsidian(({ app }, id) => (app as unknown as { plugins: { plugins: Record<string, TestPlugin> } }).plugins.plugins[id]!.pro.signOut(), pluginId);
  expect((await snapshot())?.hidden).toEqual([]); await fold(3); expect((await waitFold()).hidden[0]).not.toContain('Tail');
 });
 it('maps a folded range when text is inserted before its heading', async () => {
  await expectCustom();
  const prefix = 'Introductory line\n\n';
  const before = await snapshot();
  await browser.executeObsidian(({ app }, id, text) => {
   const p = (app as unknown as { plugins: { plugins: Record<string, TestPlugin> } }).plugins.plugins[id]!;
   const { editorInfoField } = require('obsidian') as typeof import('obsidian');
   const view = [...p.editorViews].find(v => v.state.field(editorInfoField, false)?.editor === app.workspace.activeEditor?.editor)!;
   view.dispatch({ changes: { from: 0, insert: text } });
  }, pluginId, prefix);
  const state = await waitFold();
  expect(state.hidden).toEqual(before!.hidden);
  expect(state.positions[0]).toEqual(before!.positions[0]!.map(pos => pos + prefix.length));
  expect(state.doc).toBe(prefix + TEXT);
  await browser.executeObsidian(({ app }) => app.workspace.activeEditor!.editor!.exec('unfoldAll'));
  await fold(2);
  expect((await waitFold()).hidden[0]).not.toContain('Tail');
 });
 it('expands on unload and removes the custom service', async () => {
  await expectCustom();
  const stock = await browser.executeObsidian(async ({ app }, id) => {
   const p = (app as unknown as { plugins: { plugins: Record<string, TestPlugin> } }).plugins.plugins[id]!;
   const { editorInfoField } = require('obsidian') as typeof import('obsidian');
   const { foldedRanges } = require('@codemirror/language') as typeof import('@codemirror/language');
   const view = [...p.editorViews].find(v => v.state.field(editorInfoField, false)?.editor === app.workspace.activeEditor?.editor)!;
   await (app as unknown as { plugins: { disablePlugin(id: string): Promise<void> } }).plugins.disablePlugin(id);
   const expanded = foldedRanges(view.state).size === 0;
   app.workspace.activeEditor!.editor!.setCursor({ line: 0, ch: 0 }); app.workspace.activeEditor!.editor!.exec('toggleFold');
   const hidden: string[] = [];
   for (const cursor = foldedRanges(view.state).iter(); cursor.value; cursor.next()) hidden.push(view.state.doc.sliceString(cursor.from, cursor.to));
   return { expanded, hidden, doc: view.state.doc.toString() };
  }, pluginId);
  await browser.executeObsidian(async ({ app }, id) => { await (app as unknown as { plugins: { enablePlugin(id: string): Promise<boolean> } }).plugins.enablePlugin(id); }, pluginId);
  expect(stock.expanded).toBe(true);
  expect(stock.hidden).toHaveLength(1);
  expect(stock.hidden[0]).toContain('Tail line');
  expect(stock.doc).toBe(TEXT);
  expect((await snapshot())?.doc).toBe(TEXT);
 });
});

const MARKER = '# Head\nBody line\n\n%% fold-stop %%\nTail line\n# End\nEnd body\n';

describe(`${pluginId} end markers`, function () {
 beforeEach(async () => configure());
 after(async () => configure());
 for (const source of [true, false]) {
  it(`stops before an end marker in ${source ? 'Source' : 'Live Preview'} mode and keeps the saved text`, async () => {
   const path = `Marker ${source ? 'Source' : 'Live Preview'}.md`;
   await expectCustom(MARKER, 0, source, path);
   const state = (await snapshot())!;
   expect(state.hidden).toEqual(['\nBody line\n']);
   if (source) expect(state.visible).toContain('%% fold-stop %%');
   expect(await browser.executeObsidian(({ app }, file) => app.vault.adapter.read(file), path)).toBe(MARKER);
  });
 }
 it('ends a child fold at a level 4 marker and the parent fold at the rule', async () => {
  const text = '### B\nbody\n#### C\nchild body\n\n%% fold-stop 4 %%\nmore H3 text\n\n---\nTail\n';
  await open(text); await fold(2);
  const child = await waitFold();
  expect(child.hidden).toEqual(['\nchild body\n']);
  expect(child.visible).toContain('more H3 text');
  await browser.executeObsidian(({ app }) => app.workspace.activeEditor!.editor!.exec('unfoldAll'));
  await fold(0);
  const parent = await waitFold();
  expect(parent.hidden).toHaveLength(1);
  expect(parent.hidden[0]).toContain('fold-stop 4');
  expect(parent.hidden[0]).toContain('more H3 text');
  expect(parent.hidden[0]).not.toContain('---');
  expect(parent.visible).toContain('Tail');
  expect(parent.doc).toBe(text);
 });
 it('expands stored folds when end markers turn off and then folds past the marker', async () => {
  await expectCustom(MARKER);
  await configure({ endMarkers: false });
  expect((await snapshot())?.hidden).toEqual([]);
  await fold();
  const state = await waitFold();
  expect(state.hidden[0]).toContain('%% fold-stop %%');
  expect(state.hidden[0]).toContain('Tail line');
  expect(state.doc).toBe(MARKER);
 });
 it('restores normal folding in a note with a marker', async () => {
  await expectCustom(MARKER);
  await browser.executeObsidianCommand(`${pluginId}:restore-normal-folding`);
  expect((await snapshot())?.hidden).toEqual([]);
  await fold();
  const state = await waitFold();
  expect(state.hidden[0]).toContain('%% fold-stop %%');
  expect(state.hidden[0]).toContain('Tail line');
  expect(state.doc).toBe(MARKER);
 });
});
