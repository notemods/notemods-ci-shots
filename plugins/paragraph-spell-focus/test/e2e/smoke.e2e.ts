import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId, reloadPlugin } from './load';

const source = '# Draft\n\nFirst lantren paragraph.\nA second line.\n\nOther inventednname paragraph.\n\n# Next\nLast paragraph.';

describe(`${pluginId} spelling scope`, function () {
 it('loads and reloads without console errors', async () => {
  expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] });
 });
 it('moves the native suppression range without changing the note', async () => {
  await obsidianPage.write('Focus.md', source);
  await obsidianPage.openFile('Focus.md');
  await browser.$('.cm-content').click();
  await browser.executeObsidian(({ app }) => {
   const editor = app.workspace.activeEditor?.editor;
   editor?.setCursor({ line: 2, ch: 10 }); editor?.focus();
  });
  await browser.waitUntil(async () => browser.execute(() => {
   const lines = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'));
   return lines.some(line => line.textContent?.includes('First lantren') && line.dataset.spellFocus === 'active') && lines.some(line => line.textContent?.includes('Other invented') && line.getAttribute('spellcheck') === 'false');
  }), { timeout: 10000 });
  await browser.executeObsidian(({ app }) => { const e = app.workspace.activeEditor?.editor; e?.setSelection({ line: 2, ch: 0 }, { line: 2, ch: 5 }); e?.focus(); });
  await browser.waitUntil(async () => browser.execute(() => Array.from(document.querySelectorAll<HTMLElement>('.cm-line')).some(line => line.textContent?.includes('First lantren') && line.dataset.spellFocus === 'active' && line.getAttribute('spellcheck') !== 'false')), { timeout: 5000 });
  await browser.executeObsidian(({ app }) => { const e = app.workspace.activeEditor?.editor; e?.setCursor({ line: 5, ch: 10 }); e?.focus(); });
  await browser.waitUntil(async () => browser.execute(() => {
   const lines = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'));
   return lines.some(line => line.textContent?.includes('Other invented') && line.dataset.spellFocus === 'active') && lines.some(line => line.textContent?.includes('First lantren') && line.getAttribute('spellcheck') === 'false');
  }), { timeout: 10000 });
  expect(await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.getValue())).toBe(source);
 });
 it('restores native scope with the free toggle command', async () => {
  await browser.executeObsidianCommand(`${pluginId}:toggle-focus`);
  await browser.waitUntil(async () => browser.execute(() => document.querySelector('[data-spell-focus]') === null), { timeout: 5000 });
  expect(await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.getValue())).toBe(source);
  await browser.executeObsidianCommand(`${pluginId}:toggle-focus`);
 });
});
