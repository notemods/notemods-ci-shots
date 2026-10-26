import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import LiveTemplateResultsPlugin from '../src/main';
import { bindPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';

afterEach(() => { resetPro(); vi.restoreAllMocks(); });
const pro = () => bindPro({ isPro: () => true, onChange: () => () => undefined } as never);

describe('audit a40', () => {
 it('keeps a manual disable when the note is renamed into a rule folder', async () => {
  const app = App.createConfigured__({ files: { 'Trusted/Blocked.md': '<%+ 1 %>' } });
  const plugin = new LiveTemplateResultsPlugin(app as never, manifest as never);
  await plugin.onload(); pro();
  plugin.settings.folders = 'Trusted';
  await plugin.setEnabled('Trusted/Blocked.md', false);
  await app.vault.rename(app.vault.getFileByPath('Trusted/Blocked.md')!, 'Trusted/Renamed.md');
  await Promise.resolve();
  expect(plugin.isEnabled('Trusted/Renamed.md')).toBe(false);
  expect(plugin.settings.disabled).toEqual(['Trusted/Renamed.md']);
  plugin.onunload();
 });
 it('removes a manual enable when the note is renamed', async () => {
  const app = App.createConfigured__({ files: { 'A.md': '<%+ 1 %>' } });
  const plugin = new LiveTemplateResultsPlugin(app as never, manifest as never);
  await plugin.onload();
  await plugin.setEnabled('A.md', true);
  await app.vault.rename(app.vault.getFileByPath('A.md')!, 'B.md');
  await Promise.resolve();
  expect(plugin.settings.enabled).toEqual([]);
  expect(plugin.isEnabled('B.md')).toBe(false);
  plugin.onunload();
 });
 it('syncs only the editors of the changed file', () => {
  const app = App.createConfigured__({ files: { 'a.md': '', 'b.md': '' } });
  const plugin = new LiveTemplateResultsPlugin(app as never, manifest as never);
  const a = { path: 'a.md', sync: vi.fn(), requestMetadataRefresh: vi.fn(), metadataPending: false };
  const b = { path: 'b.md', sync: vi.fn(), requestMetadataRefresh: vi.fn(), metadataPending: false };
  plugin.editors.add(a as never); plugin.editors.add(b as never);
  plugin.onMetadataChanged(app.vault.getFileByPath('b.md')! as never, '', {} as never);
  expect(b.sync).toHaveBeenCalledOnce(); expect(a.sync).not.toHaveBeenCalled();
 });
 it('does not keep metadata stamps for files without an open editor', () => {
  const app = App.createConfigured__({ files: { 'b.md': '' } });
  const plugin = new LiveTemplateResultsPlugin(app as never, manifest as never);
  plugin.onMetadataChanged(app.vault.getFileByPath('b.md')! as never, '', {} as never);
  expect((plugin as unknown as { metadata: Map<string, string> }).metadata.size).toBe(0);
 });
 it('retries a pending metadata refresh on the next metadata event', () => {
  const app = App.createConfigured__({ files: { 'a.md': '---\nhours: 2\n---\n' } });
  const plugin = new LiveTemplateResultsPlugin(app as never, manifest as never);
  plugin.settings.watch = 'hours'; pro();
  const editor = { path: 'a.md', sync: vi.fn(), requestMetadataRefresh: vi.fn(), metadataPending: true };
  plugin.editors.add(editor as never);
  const file = app.vault.getFileByPath('a.md')! as never;
  plugin.onMetadataChanged(file, 'first', { frontmatter: { hours: 2 } } as never);
  plugin.onMetadataChanged(file, 'second', { frontmatter: { hours: 2 } } as never);
  expect(editor.requestMetadataRefresh).toHaveBeenLastCalledWith('second');
 });
});
