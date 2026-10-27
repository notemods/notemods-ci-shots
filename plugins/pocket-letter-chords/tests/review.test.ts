import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import PocketLetterChordsPlugin from '../src/main';
import { checkFolder, normalizeSettings, validateBindings } from '../src/chords';
import { resetPro } from '../src/pro';
import manifest from '../manifest.json';
afterEach(() => { resetPro(); });
function setup() {
 const app = App.createConfigured__({ files: { 'A.md': '' } });
 const plugin = new PocketLetterChordsPlugin(app as never, manifest as never);
 plugin.settings = normalizeSettings({ dictionaries: [{ name: 'Default', folder: '', bindings: [{ keys: 'jk', text: 'Done' }] }] });
 const editor = { hasFocus: () => true, listSelections: () => [{}], replaceSelection: vi.fn() };
 vi.spyOn(app.workspace, 'getActiveViewOfType').mockReturnValue({ editor, file: { path: 'A.md' } } as never);
 return { plugin, editor };
}
function send(plugin: PocketLetterChordsPlugin, target: HTMLElement, k: string, opts: KeyboardEventInit = {}): KeyboardEvent {
 const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts });
 const listener = (ev: Event) => plugin.keyDown(ev as KeyboardEvent);
 target.addEventListener('keydown', listener); target.dispatchEvent(e); target.removeEventListener('keydown', listener);
 return e;
}
function editorDom(cls: string) {
 const scroller = document.createElement('div'); scroller.className = cls; const content = document.createElement('div'); content.className = 'cm-content';
 scroller.appendChild(content); document.body.appendChild(scroller); return { scroller, content };
}
describe('review fixes', () => {
 it('passes letters through in Vim normal mode', () => {
  const { plugin, editor } = setup();
  const { scroller, content } = editorDom('cm-scroller cm-vimMode');
  const e = send(plugin, content, 'j'); plugin.flushInput();
  expect(e.defaultPrevented).toBe(false); expect(editor.replaceSelection).not.toHaveBeenCalled(); scroller.remove();
 });
 it('still runs chords in Vim insert mode', () => {
  const { plugin, editor } = setup();
  const { scroller, content } = editorDom('cm-scroller');
  send(plugin, content, 'j'); send(plugin, content, 'k'); plugin.flushInput();
  expect(editor.replaceSelection).toHaveBeenCalledExactlyOnceWith('Done', 'pocket-letter-chords'); scroller.remove();
 });
 it('passes Caps Lock letters through', () => {
  const { plugin, editor } = setup(); const e = send(plugin, document.body, 'J'); plugin.flushInput();
  expect(e.defaultPrevented).toBe(false); expect(editor.replaceSelection).not.toHaveBeenCalled();
 });
 it('keeps the valid rows of a dictionary that has one invalid row', () => {
  const s = normalizeSettings({ dictionaries: [{ name: 'Default', folder: '', bindings: [{ keys: 'qw', text: 'Done' }, { keys: 'QW', text: 'Bad' }, { keys: 'as', text: 'Action' }] }] });
  expect(s.dictionaries[0]!.bindings).toEqual([{ keys: 'qw', text: 'Done' }, { keys: 'as', text: 'Action' }]);
 });
 it('rejects a vault root folder for a folder dictionary', () => {
  for (const path of ['/', '', '.', 'a/../b']) expect(() => checkFolder('Work', path)).toThrow();
  expect(() => checkFolder(' ', 'Work')).toThrow(); expect(() => checkFolder('Work', 'Work/Team')).not.toThrow();
 });
 it('accepts a value of 10000 characters and rejects 10001', () => {
  expect(validateBindings([{ keys: 'qw', text: 'a'.repeat(10000) }])).toHaveLength(1);
  expect(() => validateBindings([{ keys: 'qw', text: 'a'.repeat(10001) }])).toThrow();
 });
 it.each(['pointerdown', 'paste', 'focusout'])('flushes a pending letter on %s after onload', async type => {
  const { plugin, editor } = setup(); vi.spyOn(plugin, 'loadData').mockResolvedValue(plugin.settings); plugin.load(); await vi.waitFor(() => expect(plugin.pro).not.toBeNull());
  send(plugin, document.body, 'j'); expect(editor.replaceSelection).not.toHaveBeenCalled();
  document.body.dispatchEvent(new Event(type, { bubbles: true })); expect(editor.replaceSelection).toHaveBeenCalledExactlyOnceWith('j', 'pocket-letter-chords');
  plugin.unload();
 });
});
