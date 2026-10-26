import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, TFile } from 'obsidian-test-mocks/obsidian';
import Finder from '../src/main';
import manifest from '../manifest.json';
import { resetPro } from '../src/pro';

afterEach(() => { vi.restoreAllMocks(); resetPro(); });
function plugin(active: string | null) {
 const app = App.createConfigured__({ files: { 'Parents/A.md': '![[S]]', 'Parents/B.md': '![[S]]', 'S.md': 'blue bird', 'Picture.png': '' } });
 const file = active ? app.vault.getAbstractFileByPath(active) as TFile : null;
 vi.spyOn(app.workspace, 'getActiveFile').mockReturnValue(file as never);
 return new Finder(app as never, manifest as never);
}
describe('single note scope', () => {
 it('searches one container and ignores the other notes', async () => {
  const p = plugin('Parents/A.md');
  const all = await p.runSearch({ folder: '', query: 'blue bird' });
  const one = await p.runSearch({ folder: '', query: 'blue bird', note: 'Parents/A.md' });
  expect(all.matches.map((m) => m.container)).toEqual(['Parents/A.md', 'Parents/B.md', 'S.md']);
  expect(one.matches.map((m) => [m.container, m.source])).toEqual([['Parents/A.md', 'S.md']]);
  expect(one.scanned).toBe(1);
 });
 it('opens the window with the active note selected', () => {
  const modal = plugin('Parents/A.md').openSearch(true);
  expect(modal.activeOnly.checked).toBe(true);
  expect(modal.activeOnly.disabled).toBe(false);
  expect(modal.folder.disabled).toBe(true);
  expect(modal.contentEl.textContent).toContain('Parents/A.md');
 });
 it('offers the choice without selecting it from the general command', async () => {
  const modal = plugin('Parents/A.md').openSearch();
  expect(modal.activeOnly.checked).toBe(false);
  expect(modal.folder.disabled).toBe(false);
  modal.query.value = 'blue bird';
  const result = await modal.run();
  expect(result?.matches.map((m) => m.container)).toEqual(['Parents/A.md', 'Parents/B.md', 'S.md']);
 });
 it('searches only the active note when the choice is selected', async () => {
  const modal = plugin('Parents/B.md').openSearch(true);
  modal.query.value = 'blue bird';
  const result = await modal.run();
  expect(result?.matches.map((m) => [m.container, m.source])).toEqual([['Parents/B.md', 'S.md']]);
  expect(modal.folder.disabled).toBe(true);
  expect(modal.activeOnly.disabled).toBe(false);
  modal.activeOnly.checked = false; modal.activeOnly.dispatchEvent(new Event('change'));
  expect(modal.folder.disabled).toBe(false);
 });
 it('disables the choice when no Markdown note is active', () => {
  for (const active of [null, 'Picture.png']) {
   const modal = plugin(active).openSearch(true);
   expect(modal.activeOnly.checked).toBe(false);
   expect(modal.activeOnly.disabled).toBe(true);
   expect(modal.folder.disabled).toBe(false);
  }
 });
 it('registers a command that needs an active Markdown note', async () => {
  const p = plugin('Parents/A.md');
  const add = vi.spyOn(p, 'addCommand');
  p.manifest = manifest as never;
  await p.onload();
  const command = add.mock.calls.map((c) => c[0]).find((c) => c.id === 'search-active');
  expect(command?.name).toBe('Find text in the active note and its embeds');
  expect(command?.checkCallback?.(true)).toBe(true);
  expect(p.modals.size).toBe(0);
  command?.checkCallback?.(false);
  expect([...p.modals][0]?.activeOnly.checked).toBe(true);
  vi.spyOn(p.app.workspace, 'getActiveFile').mockReturnValue(null);
  expect(command?.checkCallback?.(true)).toBe(false);
  p.onunload();
 });
});
describe('single note scope review', () => {
 it('follows the active note when it is renamed while the window is open', async () => {
  const p = plugin('Parents/A.md');
  const modal = p.openSearch(true);
  await p.app.vault.rename(p.app.vault.getAbstractFileByPath('Parents/A.md') as TFile, 'Parents/Renamed.md');
  modal.query.value = 'blue bird';
  const result = await modal.run();
  expect(result?.matches.map((m) => m.container)).toEqual(['Parents/Renamed.md']);
 });
 it('does not ask for a folder when the active note is the scope', () => {
  const modal = plugin('Parents/A.md').openSearch(true);
  expect(modal.status.textContent).not.toContain('folder');
  modal.activeOnly.checked = false; modal.activeOnly.dispatchEvent(new Event('change'));
  expect(modal.status.textContent).toContain('folder');
 });
});
