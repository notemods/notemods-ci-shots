import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import TaskFormatBridgePlugin, { ConversionModal } from '../src/main';
import { bindPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';
afterEach(() => resetPro());
const make = () => new TaskFormatBridgePlugin(App.createConfigured__({ files: { 'Work/a.md': '- [ ] A 📅 2026-10-18', 'Work2/b.md': '- [ ] B 📅 2026-10-18', 'Work/c.md': '- [ ] C 📅 2026-02-30' } }) as never, manifest as never);
describe('free preview and Pro report', () => {
 it('does not scan without Pro', async () => { const p = make(); const read = vi.spyOn(p.app.vault, 'cachedRead'); await expect(p.scan('Work', 'dataview')).rejects.toThrow('Pro'); expect(read).not.toHaveBeenCalled(); });
 it('reads only the selected folder and reports invalid input', async () => {
  bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
  const p = make(); const write = vi.spyOn(p.app.vault, 'modify');
  const r = await p.scan('Work', 'dataview'); expect(r.limited).toBe(false); expect(r.rows.map((x) => x.path)).toEqual(['Work/a.md', 'Work/c.md']);
  expect(r.rows[0]!.changes).toBe(1); expect(r.rows[1]!.warnings).toHaveLength(1); expect(write).not.toHaveBeenCalled();
 });
 it.each(['', '/', ' / ', '\\'])('scans the vault for root path %j', async (folder) => {
  bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
  const r = await make().scan(folder, 'dataview');
  expect(r.rows.map((row) => row.path)).toEqual(['Work/a.md', 'Work/c.md', 'Work2/b.md']);
  expect(r.rows.map((row) => row.changes)).toEqual([1, 0, 1]);
 });
 it('reports unreadable files', async () => {
  bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
  const p = make(); vi.spyOn(p.app.vault, 'cachedRead').mockRejectedValue(new Error('read'));
  expect((await p.scan('Work', 'emoji')).rows[0]!.warnings[0]!.reason).toBe('File could not be read.');
 });
 it('marks a file-count limit as incomplete', async () => {
  bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
  const p = make();
  vi.spyOn(p.app.vault, 'getMarkdownFiles').mockReturnValue(Array.from({ length: 501 }, (_, n) => ({ path: `Work/${String(n).padStart(3, '0')}.md`, stat: { size: 1 } })) as never);
  vi.spyOn(p.app.vault, 'cachedRead').mockResolvedValue('');
  const r = await p.scan('Work', 'emoji'); expect(r.rows).toHaveLength(500); expect(r.limited).toBe(true);
 });
 it('does not include a file that would exceed the character budget', async () => {
  bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
  const p = make();
  vi.spyOn(p.app.vault, 'getMarkdownFiles').mockReturnValue(Array.from({ length: 7 }, (_, n) => ({ path: `Work/${n}.md`, stat: { size: 1 } })) as never);
  vi.spyOn(p.app.vault, 'cachedRead').mockResolvedValue('x'.repeat(900_000));
  const r = await p.scan('Work', 'emoji'); expect(r.rows).toHaveLength(5); expect(r.limited).toBe(true);
 });
 it('makes a free preview without a license', () => {
  const p = make(), editor = { getValue: () => '- [ ] A 📅 2026-10-18' };
  const modal = new ConversionModal(p, editor as never, 'Work/a.md', 'dataview');
  expect(modal.result.text).toBe('- [ ] A [due:: 2026-10-18]');
 });
 it('does not write from an expired preview', () => {
  const p = make(); let text = '- [ ] A 📅 2026-10-18'; const transaction = vi.fn();
  const editor = { getValue: () => text, transaction };
  const modal = new ConversionModal(p, editor as never, 'Work/a.md', 'dataview');
  text += ' changed'; vi.spyOn(p.app.workspace, 'getActiveViewOfType').mockReturnValue({ file: { path: 'Work/a.md' }, editor } as never);
  modal.apply(); expect(transaction).not.toHaveBeenCalled();
 });
 it('applies once with a single transaction', () => {
  const p = make(); const editor = { getValue: () => '- [ ] A 📅 2026-10-18', transaction: vi.fn() };
  const modal = new ConversionModal(p, editor as never, 'Work/a.md', 'dataview');
  vi.spyOn(p.app.workspace, 'getActiveViewOfType').mockReturnValue({ file: { path: 'Work/a.md' }, editor } as never);
  modal.apply(); expect(editor.transaction).toHaveBeenCalledOnce(); expect(editor.transaction.mock.calls[0]![0].changes).toEqual([{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 21 }, text: '- [ ] A [due:: 2026-10-18]' }]);
 });
});
