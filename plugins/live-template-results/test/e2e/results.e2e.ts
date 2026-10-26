import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import type LiveTemplateResultsPlugin from '../../src/main';

const id = 'live-template-results';
async function open(path: string, source: string): Promise<void> {
 await obsidianPage.write(path, source);
 await obsidianPage.openFile(path);
 await browser.executeObsidian(async ({ app, obsidian }) => {
  const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
  if (view) await view.leaf.setViewState({ type: 'markdown', state: { file: view.file?.path, mode: 'source', source: false } });
 });
 await browser.waitUntil(async () => browser.executeObsidian(({ plugins }, path) => {
  const p = plugins.liveTemplateResults as LiveTemplateResultsPlugin;
  return [...p.editors].some((e) => e.path === path);
 }, path), { timeout: 10000, timeoutMsg: `No editor for ${path}` });
 await browser.executeObsidian(({ app }) => { app.workspace.activeEditor?.editor?.setCursor({ line: 0, ch: 0 }); });
}
async function enable(path: string): Promise<void> {
 await browser.executeObsidian(async ({ plugins }, path) => {
  const p = plugins.liveTemplateResults as LiveTemplateResultsPlugin;
  await p.setEnabled(path, true);
  await Promise.all([...p.editors].filter((e) => e.path === path).map((e) => e.pending));
 }, path);
}
async function state(path: string) {
 return browser.executeObsidian(({ plugins }, path) => {
  const p = plugins.liveTemplateResults as LiveTemplateResultsPlugin;
  const e = [...p.editors].find((e) => e.path === path);
  return { source: e?.source, results: e?.snapshot?.results ?? [], widgets: e?.view.dom.querySelectorAll('.ltr-result').length ?? 0, errors: e?.view.dom.querySelectorAll('.ltr-error').length ?? 0 };
 }, path);
}

describe('Live Preview results with Templater 2.26.0', () => {
 it('requires enable, renders arithmetic, and keeps the source', async () => {
  const source = '# Arithmetic\n\nThe total is <%+ 1 + 1 %>.\n';
  await open('Arithmetic.md', source);
  expect((await state('Arithmetic.md')).results).toEqual([]);
  await enable('Arithmetic.md');
  const s = await state('Arithmetic.md');
  expect(s.source).toBe(source); expect(s.results.map((r) => r.text)).toEqual(['2']); expect(s.widgets).toBe(1);
 });
 it('shows editable source on pointer input and reuses its cached result', async () => {
  await open('Counter.md', '# Counter\n\n<%+ (window.__ltrRuns = (window.__ltrRuns || 0) + 1) %>\n');
  await browser.execute(() => { Object.assign(window, { __ltrRuns: 0 }); });
  await enable('Counter.md');
  const widget = await browser.$('.workspace-leaf.mod-active .ltr-result');
  await widget.click();
  expect((await state('Counter.md')).widgets).toBe(0);
  await browser.executeObsidian(({ app }) => { app.workspace.activeEditor?.editor?.setCursor({ line: 0, ch: 0 }); });
  expect((await state('Counter.md')).widgets).toBe(1);
  expect(await browser.execute(() => (window as unknown as { __ltrRuns: number }).__ltrRuns)).toBe(1);
 });
 it('ignores frontmatter, fences and inline code', async () => {
  const source = '---\nexample: "<%+ 5 %>"\n---\n# Excluded\n\n`<%+ 6 %>`\n\n```js\n<%+ 7 %>\n```\n\n<%+ 8 %>\n';
  await open('Excluded.md', source); await enable('Excluded.md');
  const s = await state('Excluded.md'); expect(s.results.map((r) => r.text)).toEqual(['8']); expect(s.source).toBe(source);
 });
 it('preserves punctuation in scripts through the public renderer', async () => {
  await open('Punctuation.md', '# Punctuation\n\n<%+ "a_b**<&" %>\n'); await enable('Punctuation.md');
  expect((await state('Punctuation.md')).results.map((r) => r.text)).toEqual(['a_b**<&']);
 });
 it('discards a slow result after a source edit', async () => {
  await open('Slow.md', '# Slow\n\n<%+ await new Promise(r => { window.__ltrRelease = r; }) %>\n');
  await browser.executeObsidian(async ({ plugins }) => { await (plugins.liveTemplateResults as LiveTemplateResultsPlugin).setEnabled('Slow.md', true); });
  await browser.waitUntil(async () => browser.execute(() => typeof (window as unknown as { __ltrRelease?: unknown }).__ltrRelease === 'function'), { timeout: 10000 });
  await browser.executeObsidian(({ app }) => { app.workspace.activeEditor?.editor?.setValue('# Changed\n\n<%+ 4 %>\n'); });
  await browser.execute(() => { (window as unknown as { __ltrRelease: (s: string) => void }).__ltrRelease('OLD'); });
  await browser.executeObsidian(async ({ plugins }) => { await Promise.all([...(plugins.liveTemplateResults as LiveTemplateResultsPlugin).editors].map((e) => e.pending)); });
  expect((await state('Slow.md')).results).toEqual([]);
  await browser.executeObsidian(async ({ plugins }) => { await (plugins.liveTemplateResults as LiveTemplateResultsPlugin).refreshPath('Slow.md'); });
  expect((await state('Slow.md')).results.map((r) => r.text)).toEqual(['4']);
 });
 it('serializes two commands and runs each once on explicit refresh', async () => {
  await open('Queue.md', '# Queue\n\n<%+ (window.__ltrCount = (window.__ltrCount || 0) + 1) %> and <%+ (window.__ltrCount = (window.__ltrCount || 0) + 1) %>\n');
  await browser.execute(() => { Object.assign(window, { __ltrCount: 0 }); });
  await enable('Queue.md');
  expect((await state('Queue.md')).results.map((r) => r.text)).toEqual(['1', '2']);
  await browser.executeObsidian(async ({ plugins }) => { await (plugins.liveTemplateResults as LiveTemplateResultsPlugin).refreshPath('Queue.md'); });
  expect((await state('Queue.md')).results.map((r) => r.text)).toEqual(['3', '4']);
 });
 it('uses the owner file in two open notes', async () => {
  await open('Owner A.md', '# Owner A\n\n<%+ tp.file.title %>\n'); await enable('Owner A.md');
  await browser.executeObsidian(async ({ app }) => {
   const path = 'Owner B.md';
   const file = app.vault.getFileByPath(path) ?? await app.vault.create(path, '# Owner B\n\n<%+ tp.file.title %>\n');
   await app.workspace.getLeaf('split').openFile(file, { state: { mode: 'source', source: false } });
  });
  await browser.waitUntil(async () => browser.executeObsidian(({ plugins }) => [...(plugins.liveTemplateResults as LiveTemplateResultsPlugin).editors].some((e) => e.path === 'Owner B.md')), { timeout: 10000 });
  await enable('Owner B.md');
  await browser.executeObsidian(async ({ plugins }) => { await (plugins.liveTemplateResults as LiveTemplateResultsPlugin).refreshPath('Owner A.md'); });
  expect((await state('Owner A.md')).results.map((r) => r.text)).toEqual(['Owner A']);
  expect((await state('Owner B.md')).results.map((r) => r.text)).toEqual(['Owner B']);
 });
 it('leaves source editable when Templater is off and removes widgets on disable', async () => {
  await open('No host.md', '# Missing host\n\n<%+ 1 + 1 %>\n');
  await browser.executeObsidian(async ({ app }) => {
   await (app as unknown as { plugins: { disablePlugin(id: string): Promise<void> } }).plugins.disablePlugin('templater-obsidian');
  });
  try {
   await enable('No host.md');
   const s = await state('No host.md'); expect(s.results[0]?.error).toContain('No result produced'); expect(s.widgets).toBe(0); expect(s.errors).toBe(1);
   await browser.executeObsidian(async ({ plugins }) => { await (plugins.liveTemplateResults as LiveTemplateResultsPlugin).setEnabled('No host.md', false); });
   expect((await state('No host.md')).results).toEqual([]); expect((await state('No host.md')).errors).toBe(0);
  } finally {
   await browser.executeObsidian(async ({ app }) => { await (app as unknown as { plugins: { enablePlugin(id: string): Promise<void> } }).plugins.enablePlugin('templater-obsidian'); });
  }
 });
});

describe('Pro boundaries and metadata refresh', () => {
 it('keeps property rules off when free, then enables them through the Sponsors manager', async () => {
  await open('Pro rules.md', '---\nhours: 2\nlive-results: true\n---\n# Rules\n\n<%+ tp.frontmatter.hours %>\n');
  await browser.executeObsidian(({ plugins }) => {
   const p = plugins.liveTemplateResults as LiveTemplateResultsPlugin;
   p.settings.property = 'live-results'; p.settings.watch = 'hours'; p.syncEditors();
  });
  expect((await state('Pro rules.md')).results).toEqual([]);
  await browser.executeObsidian(async ({ app, plugins }) => {
   const p = plugins.liveTemplateResults as LiveTemplateResultsPlugin;
   const manager = p.pro as unknown as { opts: { http: () => Promise<unknown> } };
   manager.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'test-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
   app.secretStorage.setSecret('live-template-results-github-token', 'gho_' + '0'.repeat(36));
   await p.pro!.refreshNow();
   await Promise.all([...p.editors].filter((e) => e.path === 'Pro rules.md').map((e) => e.pending));
  });
  expect((await state('Pro rules.md')).results.map((r) => r.text)).toEqual(['2']);
 });
 it('refreshes the selected property after the editor and cache agree', async () => {
  await browser.executeObsidian(async ({ app }) => { const file = app.vault.getFileByPath('Pro rules.md')!; await app.fileManager.processFrontMatter(file, (fm) => { fm.hours = 3; }); });
  await browser.waitUntil(async () => (await state('Pro rules.md')).results.some((r) => r.text === '3'), { timeout: 10000, timeoutMsg: 'Selected property did not refresh the result' });
  expect((await state('Pro rules.md')).source).toContain('hours: 3');
 });
 it('does not start a metadata refresh while an obsolete script still runs', async () => {
  await browser.execute(() => { Object.assign(window, { __ltrSlowRuns: 0, __ltrSlowRelease: null }); });
  const source = '---\nhours: 2\nlive-results: true\n---\n# Slow metadata\n\n<%+ await new Promise(r => { window.__ltrSlowRuns += 1; window.__ltrSlowRelease = r; }) %>\n';
  await open('Pro slow.md', source);
  await browser.waitUntil(async () => browser.execute(() => typeof (window as unknown as { __ltrSlowRelease: unknown }).__ltrSlowRelease === 'function'), { timeout: 10000 });
  await browser.executeObsidian(({ app }) => {
   const editor = app.workspace.activeEditor!.editor!;
   editor.setValue(editor.getValue().replace('hours: 2', 'hours: 4'));
  });
  await browser.waitUntil(async () => browser.executeObsidian(({ app }) => app.metadataCache.getFileCache(app.vault.getFileByPath('Pro slow.md')!)?.frontmatter?.hours === 4), { timeout: 10000 });
  await browser.execute(() => { (window as unknown as { __ltrSlowRelease: (s: string) => void }).__ltrSlowRelease('old'); });
  await browser.executeObsidian(async ({ plugins }) => { await Promise.all([...(plugins.liveTemplateResults as LiveTemplateResultsPlugin).editors].map((e) => e.pending)); });
  expect(await browser.execute(() => (window as unknown as { __ltrSlowRuns: number }).__ltrSlowRuns)).toBe(1);
  expect((await state('Pro slow.md')).results).toEqual([]);
  await obsidianPage.openFile('Pro rules.md');
 });
 it('opens the cached panel and clears rule results on sign out', async () => {
  await browser.executeObsidianCommand('live-template-results:open-panel');
  await browser.waitUntil(async () => (await browser.$('.ltr-panel')).isExisting(), { timeout: 5000 });
  expect(await browser.$('.ltr-panel').getText()).toContain('Pro rules.md');
  await browser.executeObsidian(({ plugins }) => { (plugins.liveTemplateResults as LiveTemplateResultsPlugin).pro!.signOut(); });
  expect((await state('Pro rules.md')).results).toEqual([]);
  expect(await browser.$('.ltr-panel').getText()).toContain('Sign in');
 });
});
