import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import LiveTemplateResultsPlugin from '../src/main';
import { commands } from '../src/model';
import { bindPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';

describe('code and comment contexts found in review', () => {
 it('excludes a fenced command after an unclosed backtick in an earlier paragraph', () => {
  expect(commands('A stray ` mark.\n```\n`<%+ tp.file.title %>\n```\n')).toEqual([]);
 });
 it('excludes a fenced command after an unclosed backtick on the line before the fence', () => {
  expect(commands('A stray ` mark.\n\n```sh\necho ` <%+ 1 %>\n```')).toEqual([]);
 });
 it('does not close a fence on a line indented by four spaces', () => {
  expect(commands('```\n    ```\n<%+ 1 %>\n```')).toEqual([]);
 });
 it('excludes Obsidian comments on one line and across lines', () => {
  expect(commands('%% <%+ 1 %> %%')).toEqual([]);
  expect(commands('%%\n<%+ 1 %>\n%%')).toEqual([]);
 });
 it('keeps a command after a closed Obsidian comment', () => {
  expect(commands('%% note %% <%+ 1 %>').map((c) => c.source)).toEqual(['<%+ 1 %>']);
 });
 it('ends an unclosed backtick at a blank line', () => {
  expect(commands('A stray ` mark.\n\n<%+ 1 %>').map((c) => c.source)).toEqual(['<%+ 1 %>']);
 });
});

describe('metadata refresh found in review', () => {
 afterEach(resetPro);
 it('refreshes on the first watched property change after an editor opens', async () => {
  const app = App.createConfigured__({ files: { 'a.md': '---\nhours: 1\n---\n<%+ tp.frontmatter.hours %>' } });
  const plugin = new LiveTemplateResultsPlugin(app as never, manifest as never);
  plugin.settings.watch = 'hours';
  bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
  const file = app.vault.getFileByPath('a.md')!;
  vi.spyOn(app.metadataCache, 'getFileCache').mockReturnValue({ frontmatter: { hours: 1 } } as never);
  const editor = { path: 'a.md', requestMetadataRefresh: vi.fn(), sync: vi.fn() };
  plugin.editors.add(editor as never);
  plugin.rememberMetadata('a.md');
  plugin.onMetadataChanged(file as never, 'new', { frontmatter: { hours: 2 } } as never);
  expect(editor.requestMetadataRefresh).toHaveBeenCalledWith('new');
 });
 it('does not refresh when only an unwatched property changes', () => {
  const app = App.createConfigured__({ files: { 'a.md': '---\nhours: 1\n---\n' } });
  const plugin = new LiveTemplateResultsPlugin(app as never, manifest as never);
  plugin.settings.watch = 'hours';
  bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
  const file = app.vault.getFileByPath('a.md')!;
  vi.spyOn(app.metadataCache, 'getFileCache').mockReturnValue({ frontmatter: { hours: 1, rate: 5 } } as never);
  const editor = { path: 'a.md', requestMetadataRefresh: vi.fn(), sync: vi.fn() };
  plugin.editors.add(editor as never);
  plugin.rememberMetadata('a.md');
  plugin.onMetadataChanged(file as never, 'new', { frontmatter: { hours: 1, rate: 6 } } as never);
  expect(editor.requestMetadataRefresh).not.toHaveBeenCalled();
 });
});
