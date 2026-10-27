import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, MarkdownView } from 'obsidian-test-mocks/obsidian';
import PocketLetterChordsPlugin from '../src/main';
import { chordKey, chooseDictionary, normalizeSettings, parseDictionary, exportDictionary, validateBindings } from '../src/chords';
import { bindPro, isPro, resetPro, SPONSORS } from '../src/pro';
import manifest from '../manifest.json';
afterEach(() => { resetPro(); vi.useRealTimers(); });
function setup() {
 const app = App.createConfigured__({ files: { 'A.md': 'old', 'B.md': '' } });
 const plugin = new PocketLetterChordsPlugin(app as never, manifest as never);
 plugin.settings = normalizeSettings({ dictionaries: [{ name: 'Default', folder: '', bindings: [{ keys: 'qw', text: 'Done' }] }] });
 const editor = { hasFocus: () => true, listSelections: () => [{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } }], replaceSelection: vi.fn() };
 vi.spyOn(app.workspace, 'getActiveViewOfType').mockReturnValue({ editor, file: { path: 'A.md' } } as never);
 return { plugin, editor, app };
}
function key(k: string, opts: KeyboardEventInit = {}) { return new KeyboardEvent('keydown', { key: k, cancelable: true, ...opts }); }
describe('plugin input guard', () => {
 it('intercepts one chord and ignores its repeats', () => {
  const { plugin, editor } = setup();
  const q = key('q'), w = key('w'); plugin.keyDown(q); plugin.keyDown(w); plugin.keyDown(key('w', { repeat: true }));
  expect(q.defaultPrevented).toBe(true); expect(w.defaultPrevented).toBe(true); expect(editor.replaceSelection).toHaveBeenCalledExactlyOnceWith('Done', 'pocket-letter-chords'); plugin.flushInput();
 });
 it.each([{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { isComposing: true }])('preserves a shortcut or composition %j', opts => {
  const { plugin, editor } = setup(); const e = key('q', opts); plugin.keyDown(e);
  expect(e.defaultPrevented).toBe(false); expect(editor.replaceSelection).not.toHaveBeenCalled(); plugin.flushInput();
 });
 it('flushes pending text before a shortcut', () => {
  const { plugin, editor } = setup(); plugin.keyDown(key('q')); const e = key('c', { ctrlKey: true }); plugin.keyDown(e);
  expect(e.defaultPrevented).toBe(false); expect(editor.replaceSelection).toHaveBeenCalledWith('q', 'pocket-letter-chords');
 });
 it('does not intercept multiple cursors, an unfocused editor or paused input', () => {
  const { plugin, editor } = setup(); editor.listSelections = () => [ {} as never, {} as never ];
  const e = key('q'); plugin.keyDown(e); expect(e.defaultPrevented).toBe(false);
  editor.listSelections = () => [{} as never]; editor.hasFocus = () => false; plugin.keyDown(key('q'));
  plugin.settings.paused = true; editor.hasFocus = () => true; plugin.keyDown(key('q')); expect(editor.replaceSelection).not.toHaveBeenCalled();
 });
 it('keeps pending text in the original editor on a view change', () => {
  const { plugin, editor, app } = setup(); plugin.keyDown(key('q'));
  const other = { ...editor, replaceSelection: vi.fn() }; vi.spyOn(app.workspace, 'getActiveViewOfType').mockReturnValue({ editor: other } as never);
  plugin.keyDown(key('.')); expect(editor.replaceSelection).toHaveBeenCalledWith('q', 'pocket-letter-chords'); expect(other.replaceSelection).not.toHaveBeenCalled();
 });
 it('uses a new timeout after an early release and a new press', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const { plugin, editor } = setup(); plugin.keyDown(key('q'));
  vi.advanceTimersByTime(10); plugin.keyUp(new KeyboardEvent('keyup', { key: 'q' }));
  vi.advanceTimersByTime(10); plugin.keyDown(key('w'));
  vi.advanceTimersByTime(60); expect(editor.replaceSelection).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(20); expect(editor.replaceSelection.mock.calls.map(c => c[0]).join('')).toBe('qw'); plugin.flushInput();
 });
 it('loads and saves the dictionary and pause state', async () => {
  const { plugin } = setup(); plugin.settings.paused = true;
  const state = structuredClone(plugin.settings); vi.spyOn(plugin, 'saveData').mockResolvedValue(); await plugin.saveSettings(); expect(plugin.saveData).toHaveBeenCalledWith(state);
  vi.spyOn(plugin, 'loadData').mockResolvedValue(state); await plugin.loadSettings(); expect(plugin.settings).toEqual(state);
 });
 it('ignores Pro triples and folders while signed out', () => {
  const { plugin, editor } = setup(); plugin.settings.dictionaries[0]!.bindings = [{ keys: 'eqw', text: 'Three' }];
  const q = key('q'); plugin.keyDown(q); expect(q.defaultPrevented).toBe(false); expect(editor.replaceSelection).not.toHaveBeenCalled(); plugin.flushInput();
 });
 it('enables triples only through the sponsor facade', () => {
  const { plugin, editor } = setup(); bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
  plugin.settings.dictionaries[0]!.bindings = [{ keys: 'eqw', text: 'Three' }];
  for (const k of 'qwe') plugin.keyDown(key(k)); expect(editor.replaceSelection).toHaveBeenCalledWith('Three', 'pocket-letter-chords'); plugin.flushInput();
 });
});
describe('dictionary checks', () => {
 it('normalizes order and plus signs', () => expect(chordKey('w+q')).toBe('qw'));
 it.each(['qq', 'Qw', 'éq', 'q', 'qwer', '1q'])('rejects invalid keys %s', k => expect(() => chordKey(k)).toThrow());
 it.each([[{keys:'qw',text:'A'},{keys:'wq',text:'B'}],[{keys:'qw',text:'A'},{keys:'qwe',text:'B'}],[{keys:'qwe',text:'A'},{keys:'qw',text:'B'}]])('rejects duplicate and subset conflicts %j', (a, b) => expect(() => validateBindings([a, b])).toThrow('Conflict'));
 it('accepts distinct triples with overlapping letters', () => expect(validateBindings([{ keys:'qwe',text:'A' },{ keys:'qwr',text:'B' }])).toHaveLength(2));
 it('round trips multiline and Unicode values without code execution', () => {
  const b = [{ keys:'qw',text:'漢字\n<script>x</script>' }]; expect(parseDictionary(exportDictionary(b))).toEqual(b);
 });
 it.each(['null','{}','{"version":2,"bindings":[]}','{"version":1,"bindings":[{"keys":"qw","text":""}]}'])('rejects malformed files %s', s => expect(() => parseDictionary(s)).toThrow());
 it('rejects excessive files and rows', () => { expect(() => parseDictionary(' '.repeat(1000001))).toThrow(); expect(() => validateBindings(Array(501).fill({ keys:'qw',text:'A' }))).toThrow(); });
 it('selects the longest complete folder prefix with Pro', () => {
  const settings = normalizeSettings({ dictionaries: [{name:'Default',folder:'',bindings:[]},{name:'Work',folder:'Work',bindings:[]},{name:'Team',folder:'Work/Team',bindings:[]}] });
  expect(chooseDictionary(settings,'Work/Team/A.md',true).name).toBe('Team'); expect(chooseDictionary(settings,'Workshop/A.md',true).name).toBe('Default'); expect(chooseDictionary(settings,'Work/A.md',false).name).toBe('Default');
 });
 it('repairs invalid persisted data', () => expect(normalizeSettings({paused:'true',dictionaries:[{name:'Bad',folder:'',bindings:[{keys:'qq',text:'x'}]}]})).toEqual({paused:false,dictionaries:[{name:'Bad',folder:'',bindings:[]}]}));
 it('uses the reference sponsor values', () => {
  expect(isPro()).toBe(false); expect(SPONSORS).toMatchObject({clientId:'Ov23lic5UPGPZqhBlBGg',minMonthlyUsd:5,oneTimeUsd:15,oneTimeMonths:0,scope:'read:user'});
 });
});
