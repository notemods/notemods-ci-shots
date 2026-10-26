import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Component, MarkdownRenderer } from 'obsidian';
import { renderCommand, NO_RESULT } from '../src/render';

afterEach(() => vi.restoreAllMocks());
describe('render lifecycle', () => {
 it('passes the owner path and removes the render child after success', async () => {
  const cleanup = vi.fn(); const owner = new Component(); owner.load();
  const spy = vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, markdown, el, path, child) => {
   expect(path).toBe('Folder/Owner.md'); expect(markdown).toContain('&#60;');
   child.register(cleanup); el.textContent = '2';
  });
  expect(await renderCommand({} as App, '<%+ 1 + 1 %>', 'Folder/Owner.md', owner)).toBe('2');
  expect(spy).toHaveBeenCalledOnce(); expect(cleanup).toHaveBeenCalledOnce(); owner.unload(); expect(cleanup).toHaveBeenCalledOnce();
 });
 it('removes the render child when a renderer throws', async () => {
  const cleanup = vi.fn(); const owner = new Component(); owner.load();
  vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, _markdown, _el, _path, child) => { child.register(cleanup); throw new Error('failed'); });
  await expect(renderCommand({} as App, '<%+ 1 %>', 'A.md', owner)).rejects.toThrow('failed');
  expect(cleanup).toHaveBeenCalledOnce(); owner.unload();
 });
 it('keeps line breaks returned by the host', async () => {
  const owner = new Component(); owner.load();
  vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, _markdown, el) => { el.textContent = 'line\n'; });
  expect(await renderCommand({} as App, '<%+ "line\\n" %>', 'A.md', owner)).toBe('line\n'); owner.unload();
 });
 it('reports an unchanged command as no result', async () => {
  const owner = new Component(); owner.load();
  vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, _markdown, el) => { el.textContent = '<%+ 1 %>'; });
  await expect(renderCommand({} as App, '<%+ 1 %>', 'A.md', owner)).rejects.toThrow(NO_RESULT); owner.unload();
 });
});
