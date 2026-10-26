import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import CardQuestionSheetPlugin from '../src/main';
import { bindPro, resetPro, SPONSORS, isPro, onProChange } from '../src/pro';
import { PreviewModal } from '../src/preview';
import { DEFAULT_PAGE } from '../src/pdf';
import { parseCards } from '../src/cards';
import manifest from '../manifest.json';
afterEach(resetPro);
function plugin() {
 const app = App.createConfigured__({ files: { 'Cards.md': 'A::1\nB::2\nC::3', 'Cards questions.pdf': 'existing' } });
 return new CardQuestionSheetPlugin(app as never, manifest as never);
}
function pro(value: boolean) { bindPro({ isPro: () => value, onChange: () => () => undefined } as never); }
describe('vault writes and access', () => {
 it('saves a new PDF without replacing the source or old output', async () => {
  const tool = plugin(); const create = vi.fn(async (path: string) => ({ path }));
  vi.spyOn(tool.app.vault, 'createBinary').mockImplementation(create as never);
  const file = await tool.saveSheet(parseCards('A::1\nC::3').cards, 'Cards.md', DEFAULT_PAGE);
  expect(file?.path).toBe('Cards questions 1.pdf');
  expect(create).toHaveBeenCalledTimes(1);
  expect(new Uint8Array(create.mock.calls[0]![1] as ArrayBuffer).slice(0, 5)).toEqual(new TextEncoder().encode('%PDF-'));
 });
 it('cancellation writes no file', () => {
  const tool = plugin(); const write = vi.spyOn(tool.app.vault, 'createBinary');
  const modal = new PreviewModal(tool, parseCards('A::1'), 'Cards.md', false); modal.open(); modal.close();
  expect(write).not.toHaveBeenCalled();
 });
 it('unsupported forms block the preview even with valid cards', () => {
  const tool = plugin(); const modal = new PreviewModal(tool, parseCards('A::1\nPhoto::![[x.png]]'), 'Cards.md', false); modal.open();
  expect((modal.contentEl.querySelector('.mod-cta') as HTMLButtonElement).disabled).toBe(true); modal.close();
 });
 it('a missing glyph blocks save before a vault write', async () => {
  const tool = plugin(); const write = vi.spyOn(tool.app.vault, 'createBinary');
  expect(await tool.saveSheet(parseCards('Han::汉').cards, 'Cards.md', DEFAULT_PAGE)).toBeNull(); expect(write).not.toHaveBeenCalled();
 });
 it('folder export and named settings need Pro', async () => {
  const tool = plugin(); const read = vi.spyOn(tool.app.vault, 'getMarkdownFiles'); const save = vi.spyOn(tool, 'saveData');
  await tool.openFolder('', ''); expect(read).not.toHaveBeenCalled();
  expect(await tool.savePreset('Exam', DEFAULT_PAGE)).toBe(false); expect(save).not.toHaveBeenCalled();
  expect(await tool.saveSheet(parseCards('A::1').cards, 'Cards.md', DEFAULT_PAGE, true)).toBeNull();
 });
 it('Pro saves named settings with normalized page values', async () => {
  const tool = plugin(); pro(true); const save = vi.spyOn(tool, 'saveData').mockResolvedValue(undefined);
  expect(await tool.savePreset(' Exam ', { margin: 1, textSize: 999, answerSpace: -1 })).toBe(true);
  expect(save).toHaveBeenCalledWith({ presets: [{ name: 'Exam', page: { margin: 24, textSize: 24, answerSpace: 0 } }] });
 });
 it('a failed preset write does not replace the saved settings', async () => {
  const tool = plugin(); pro(true); vi.spyOn(tool, 'saveData').mockRejectedValue(new Error('disk full'));
  expect(await tool.savePreset('Exam', DEFAULT_PAGE)).toBe(false); expect(tool.settings.presets).toEqual([]);
 });
 it('reports a failed PDF write without an unhandled rejection', async () => {
  const tool = plugin(); vi.spyOn(tool.app.vault, 'createBinary').mockRejectedValue(new Error('disk full'));
  await expect(tool.saveSheet(parseCards('A::1').cards, 'Cards.md', DEFAULT_PAGE)).resolves.toBeNull();
 });
 it('blocks a second write while the first one is in progress', async () => {
  const tool = plugin(); vi.spyOn(tool.app.vault, 'createBinary').mockResolvedValue({ path: 'Cards questions 1.pdf' } as never);
  const first = tool.saveSheet(parseCards('A::1').cards, 'Cards.md', DEFAULT_PAGE);
  expect(await tool.saveSheet(parseCards('A::1').cards, 'Cards.md', DEFAULT_PAGE)).toBeNull(); await first;
 });
 it('has the reference sponsor terms and clears the facade', () => {
  expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', minMonthlyUsd: 5, oneTimeUsd: 15, oneTimeMonths: 0 });
  let callback = () => {}; let state = false;
  bindPro({ isPro: () => state, onChange: (fn: () => void) => { callback = fn; return () => {}; } } as never);
  const listener = vi.fn(); const off = onProChange(listener); state = true; callback(); expect(isPro()).toBe(true); expect(listener).toHaveBeenCalledOnce(); off(); resetPro(); expect(isPro()).toBe(false);
 });
});
describe('review defects', () => {
 it('a note that starts with a rule and has no closing line keeps its cards', () => {
  expect(parseCards('---\nA::1\nB::2').cards.map((c) => c.question)).toEqual(['A', 'B']);
  expect(parseCards('---\ntags: x\n---\nA::1').cards.map((c) => c.line)).toEqual([4]);
 });
 it('reports right-to-left presentation forms and marks', () => {
  for (const text of ['Q::\ufb4f', 'Q::\ufef7', 'Q::a\u200fb']) expect(parseCards(text).unsupported.map((u) => u.reason)).toEqual(['Right-to-left text']);
 });
 it('a folder field that names a file is refused', async () => {
  const tool = plugin(); pro(true);
  await expect(tool.openFolder('Cards.md', '')).rejects.toThrow('The folder does not exist.');
 });
 it('keeps the failure message after a failed save', async () => {
  const tool = plugin(); vi.spyOn(tool, 'saveSheet').mockResolvedValue(null);
  const modal = new PreviewModal(tool, parseCards('A::1'), 'Cards.md', false); modal.open();
  modal.contentEl.querySelector('.mod-cta')!.dispatchEvent(new MouseEvent('click', { bubbles: false }));
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(modal.contentEl.querySelector('.cqs-error')?.textContent).toContain('The PDF was not saved'); modal.close();
 });
 it('uses the singular for one card', () => {
  const tool = plugin(); const modal = new PreviewModal(tool, parseCards('A::1'), 'Cards.md', false); modal.open();
  expect(modal.contentEl.querySelector('.cqs-count')?.textContent).toBe('1 card found • 1 selected'); modal.close();
 });
});
