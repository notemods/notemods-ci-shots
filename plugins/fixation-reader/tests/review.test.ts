import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import FixationReaderPlugin from '../src/main';
import { enabledFor } from '../src/rules';
import { DEFAULT_SETTINGS } from '../src/settings';
import { resetPro } from '../src/pro';
import manifest from '../manifest.json';
afterEach(() => resetPro());

describe('review fixes', () => {
 it('redraws a note on a metadata change only when its rule result changes', () => {
  const app = App.createConfigured__({ files: { 'a.md': 'Reading is fast' } });
  const p = new FixationReaderPlugin(app as never, manifest as never);
  const refresh = vi.fn(); p.refreshViews = refresh;
  p.onMetadataChanged('a.md'); p.onMetadataChanged('a.md'); p.onMetadataChanged('a.md');
  expect(refresh).toHaveBeenCalledTimes(1);
  p.settings.enabled = false; p.onMetadataChanged('a.md');
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(refresh).toHaveBeenLastCalledWith('a.md');
 });
 it('matches excluded tags without case, as Obsidian does', () => {
  const s = { ...DEFAULT_SETTINGS, excludedTags: 'Draft' };
  expect(enabledFor(s, true, 'a.md', ['#draft'], null)).toBe(false);
  expect(enabledFor(s, true, 'a.md', ['#DRAFT/child'], null)).toBe(true);
 });
 it('removes marks from Live Preview widgets that render before they attach', async () => {
  const app = App.createConfigured__({ files: { 'a.md': 'Reading is fast' } });
  const p = new FixationReaderPlugin(app as never, manifest as never);
  const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
  const editor = document.body.createDiv({ cls: 'markdown-source-view' });
  const reading = document.body.createDiv({ cls: 'markdown-preview-view' });
  const widget = document.createElement('div'); widget.textContent = 'Reading is fast';
  const section = document.createElement('div'); section.textContent = 'Reading is fast';
  p.process(widget, { sourcePath: 'a.md', frontmatter: null } as never);
  p.process(section, { sourcePath: 'a.md', frontmatter: null } as never);
  expect(widget.querySelectorAll('b.fx').length).toBe(2);
  editor.appendChild(widget); reading.appendChild(section);
  await frame(); await frame();
  expect(widget.querySelectorAll('b.fx').length).toBe(0); expect(widget.textContent).toBe('Reading is fast');
  expect(section.querySelectorAll('b.fx').length).toBe(2);
  editor.remove(); reading.remove();
 });
});
