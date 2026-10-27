import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, MarkdownView } from 'obsidian-test-mocks/obsidian';
import FixationReaderPlugin from '../src/main';
import { resetPro } from '../src/pro';
import manifest from '../manifest.json';
afterEach(() => resetPro());

describe('unload', () => {
 it('renders open notes again so detached Reading view sections also lose their marks', () => {
  const app = App.createConfigured__({ files: { 'a.md': 'Reading is fast' } });
  const p = new FixationReaderPlugin(app as never, manifest as never);
  // Reading view keeps off-screen sections of a long note out of the DOM and attaches them again without a new post process step.
  const containerEl = document.createElement('div');
  const detached = document.createElement('div'); detached.textContent = 'Reading is fast';
  p.process(detached, { sourcePath: 'a.md', frontmatter: null } as never);
  expect(detached.querySelectorAll('b.fx').length).toBe(2);
  const rerender = vi.fn();
  const view = Object.assign(Object.create(MarkdownView.prototype) as object, { previewMode: { containerEl, rerender } });
  app.workspace.iterateAllLeaves = ((cb: (leaf: unknown) => void) => { cb({ view }); }) as never;
  p.onunload();
  expect(rerender).toHaveBeenCalledWith(true);
  // A render that the unload queued must not add marks again.
  p.process(detached, { sourcePath: 'a.md', frontmatter: null } as never);
  expect(detached.querySelectorAll('b.fx').length).toBe(0);
  expect(detached.textContent).toBe('Reading is fast');
 });
});
