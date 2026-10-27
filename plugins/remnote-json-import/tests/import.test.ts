import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import ImportPlugin from '../src/main';
import { DEFAULT_LAYOUT, MAX_BYTES, compareSnapshots, planImport, safeName, stableTag, importReport } from '../src/importer';
import { bindPro, isPro, onProChange, resetPro, SPONSORS } from '../src/pro';
import { normalizeSettings } from '../src/settings';
import { writeImport } from '../src/writer';
import manifest from '../manifest.json';
const text = JSON.stringify({ docs: [{ _id: 'a', key: ['Plan'] }, { _id: 'b', parent: 'a', key: ['Step'], value: [{ i: 'q', _id: 'a' }] }] });
const enable = () => bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
const plugin = () => new ImportPlugin(App.createConfigured__({ files: { 'Welcome.md': '# Start' } }) as never, manifest as never);
afterEach(() => resetPro());

describe('write an import', () => {
 it('creates linked notes and a report through the vault API', async () => {
  const p = plugin(); const plan = planImport(text);
  const result = await p.importText(text, DEFAULT_LAYOUT);
  expect(result).toMatchObject({ complete: true, reportWritten: true, written: plan.notes.map(n => n.path) });
  expect(p.settings.snapshot).toEqual(plan.snapshot);
  const file = p.app.vault.getAbstractFileByPath(plan.notes[1]!.path);
  expect(file).toBeTruthy();
  expect((file as unknown as { path: string }).path).toBe(plan.notes[1]!.path);
  const report = p.app.vault.getAbstractFileByPath(plan.reportPath);
  expect(report).toBeTruthy();
 });
 it('refuses the same destination without replacing its content', async () => {
  const p = plugin(); await p.importText(text, DEFAULT_LAYOUT);
  const create = vi.spyOn(p.app.vault, 'create');
  await expect(p.importText(text, DEFAULT_LAYOUT)).rejects.toThrow('destination exists');
  expect(create).not.toHaveBeenCalled();
 });
 it('refuses a file as an ancestor before writing', async () => {
  const p = plugin(); await p.app.vault.create('Archive', 'Keep this');
  const create = vi.spyOn(p.app.vault, 'create');
  await expect(writeImport(p.app.vault, planImport(text, { ...DEFAULT_LAYOUT, folder: 'Archive/New' }))).rejects.toThrow('file blocks');
  expect(create).not.toHaveBeenCalled();
 });
 it('reports a partial write and keeps the last complete snapshot', async () => {
  const p = plugin(); p.settings.snapshot = { old: 'record' };
  const original = p.app.vault.create.bind(p.app.vault); let count = 0;
  vi.spyOn(p.app.vault, 'create').mockImplementation(async (path, content, options) => {
   count++; if (count === 2) throw new Error('disk full'); return original(path, content, options);
  });
  const result = await p.importText(text, DEFAULT_LAYOUT);
  expect(result).toMatchObject({ complete: false, reportWritten: true, error: 'disk full' });
  expect(result.written).toHaveLength(1); expect(p.settings.snapshot).toEqual({ old: 'record' });
  const report = p.app.vault.getAbstractFileByPath('RemNote import/Import report.md');
  expect(report).toBeTruthy();
 });
 it('reports that a report write failed', async () => {
  const p = plugin(); const original = p.app.vault.create.bind(p.app.vault);
  vi.spyOn(p.app.vault, 'create').mockImplementation(async (path, content, options) => { if (path.endsWith('Import report.md')) throw new Error('report denied'); return original(path, content, options); });
  const result = await p.importText(text, DEFAULT_LAYOUT);
  expect(result.complete).toBe(false); expect(result.reportWritten).toBe(false); expect(result.error).toContain('report denied'); expect(p.settings.snapshot).toBeNull();
 });
 it('stops if another writer takes an output path', async () => {
  const plan = planImport(text); const folders = new Map<string, object>(); const create = vi.fn(async () => ({}));
  const vault = { getAbstractFileByPath: (path: string) => path === plan.notes[0]!.path ? {} : folders.get(path) ?? null, createFolder: async (path: string) => { const folder = {}; folders.set(path, folder); return folder; }, create };
  const result = await writeImport(vault as never, plan);
  expect(result.complete).toBe(false); expect(result.error).toContain('output path exists'); expect(result.written).toEqual([]);
  expect(create).toHaveBeenCalledOnce(); expect(create.mock.calls[0]?.[0]).toBe(plan.reportPath);
 });
 it('prevents a second import while one is writing', async () => {
  const p = plugin(); const original = p.app.vault.create.bind(p.app.vault); let release!: () => void;
  const paused = new Promise<void>(r => { release = r; });
  vi.spyOn(p.app.vault, 'create').mockImplementation(async (path, content, options) => { await paused; return original(path, content, options); });
  const first = p.importText(text, DEFAULT_LAYOUT);
  await expect(p.importText(text, { ...DEFAULT_LAYOUT, folder: 'Second' })).rejects.toThrow('in progress');
  release(); expect((await first).complete).toBe(true);
 });
});

describe('Pro actions', () => {
 it('leaves core import free and gates grouped imports and preset methods', async () => {
  const p = plugin(); expect(isPro()).toBe(false);
  await expect(p.importText(text, { ...DEFAULT_LAYOUT, groupRoots: ['a'] })).rejects.toThrow('Pro feature');
  await expect(p.savePreset('Plan', DEFAULT_LAYOUT)).rejects.toThrow('Pro feature');
  expect(() => p.applyPreset('Plan')).toThrow('Pro feature'); expect(() => p.previewChanges(text)).toThrow('Pro feature');
  expect(p.app.vault.getAbstractFileByPath(DEFAULT_LAYOUT.folder)).toBeNull();
  expect((await p.importText(text, DEFAULT_LAYOUT)).complete).toBe(true);
 });
 it('saves and applies presets with copied roots', async () => {
  enable(); const p = plugin(); await p.savePreset('Study', { ...DEFAULT_LAYOUT, prefix: 'Study ', groupRoots: ['a'] });
  const layout = p.applyPreset('Study'); layout.groupRoots.push('other');
  expect(p.applyPreset('Study').groupRoots).toEqual(['a']);
  await p.savePreset('Study', { ...DEFAULT_LAYOUT, folder: 'New' }); expect(p.settings.presets).toHaveLength(1); expect(p.applyPreset('Study').folder).toBe('New');
 });
 it('groups a subtree after the Sponsors check', async () => {
  enable(); const p = plugin(); const result = await p.importText(text, { ...DEFAULT_LAYOUT, groupRoots: ['a'] });
  expect(result.complete).toBe(true); expect(result.written).toHaveLength(1);
 });
 it('compares a later export without changing vault files', async () => {
  enable(); const p = plugin(); await p.importText(text, DEFAULT_LAYOUT);
  const newer = JSON.stringify({ docs: [{ _id: 'a', key: ['Revised'] }, { _id: 'c', key: ['New'] }] });
  const create = vi.spyOn(p.app.vault, 'create');
  expect(p.previewChanges(newer)).toEqual({ added: ['c'], changed: ['a'], removed: ['b'], unchanged: [] }); expect(create).not.toHaveBeenCalled();
 });
 it('requires a complete import before comparing', () => { enable(); expect(() => plugin().previewChanges(text)).toThrow('Import an export first'); });
 it('stops Pro actions when the manager state is revoked', async () => {
  let active = true; bindPro({ isPro: () => active, onChange: () => () => undefined, getState: () => ({ status: 'signed-out', lastAttemptAt: 0 }), hasToken: () => false, config: { sponsorLogin: 'theluckystrike' } } as never);
  const p = plugin(); await p.savePreset('P', DEFAULT_LAYOUT); active = false;
  expect(() => p.applyPreset('P')).toThrow('Pro feature'); await expect(p.importText(text, { ...DEFAULT_LAYOUT, groupRoots: ['a'] })).rejects.toThrow('Pro feature');
 });
 it('matches the reference price and client', () => expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', sponsorLogin: 'theluckystrike', minMonthlyUsd: 5, oneTimeUsd: 15, oneTimeMonths: 0, scope: 'read:user' }));
 it('cleans the Pro change listener', () => {
  let change = () => {}; const unbind = vi.fn(); bindPro({ isPro: () => true, onChange: (fn: () => void) => { change = fn; return unbind; } } as never);
  const listener = vi.fn(); const off = onProChange(listener); change(); expect(listener).toHaveBeenCalledOnce(); off(); change(); expect(listener).toHaveBeenCalledOnce(); resetPro(); expect(unbind).toHaveBeenCalledOnce(); expect(isPro()).toBe(false);
 });
});

describe('parser bounds and stable output', () => {
 it('rejects an oversized input', () => expect(() => planImport(' '.repeat(MAX_BYTES + 1))).toThrow('20 MiB'));
 it('rejects more than 25000 records', () => expect(() => planImport(JSON.stringify({ docs: Array.from({ length: 25001 }, (_, i) => ({ _id: String(i), key: ['X'] })) }))).toThrow('25000'));
 it('handles a 5000-node chain without recursive tree traversal', () => {
  const docs = Array.from({ length: 5000 }, (_, i) => ({ _id: String(i), key: [`Node ${i}`], ...(i ? { parent: String(i - 1) } : {}) }));
  const plan = planImport(JSON.stringify({ docs }), { ...DEFAULT_LAYOUT, groupRoots: ['0'] }); expect(plan.notes).toHaveLength(1); expect(plan.notes[0]!.ids).toHaveLength(5000);
 }, 30000);
 it('keeps filenames within filesystem byte limits', () => { const name = safeName('😀'.repeat(100)); expect(new TextEncoder().encode(name).byteLength).toBeLessThanOrEqual(160); expect(name).not.toContain('\ufffd'); });
 it('keeps source tags and links stable when records are reordered', () => {
  const first = planImport(text); const docs = JSON.parse(text).docs; const second = planImport(JSON.stringify({ docs: docs.reverse() }));
  expect(Object.fromEntries(first.notes.map(n => [n.path, n.content]))).toEqual(Object.fromEntries(second.notes.map(n => [n.path, n.content])));
 });
 it('treats a source metadata change as a source change', () => {
  const a = planImport(JSON.stringify({ docs: [{ _id: 'a', key: ['A'], m: 1 }] })); const b = planImport(JSON.stringify({ docs: [{ _id: 'a', key: ['A'], m: 2 }] })); expect(compareSnapshots(b.snapshot, a.snapshot).changed).toEqual(['a']);
 });
 it('ignores JSON object key order in the comparison', () => {
  const a = planImport('{"docs":[{"_id":"a","key":["A"]}]}'); const b = planImport('{"docs":[{"key":["A"],"_id":"a"}]}'); expect(compareSnapshots(a.snapshot,b.snapshot).unchanged).toEqual(['a']);
 });
 it('uses own keys for source IDs such as constructor', () => { expect(compareSnapshots({ constructor: 'x' }, {})).toEqual({ added: ['constructor'], changed: [], removed: [], unchanged: [] }); });
 it('repairs invalid presets and snapshots', () => { expect(normalizeSettings({ folder: '../bad', presets: [{ name: 'X', layout: {} }], snapshot: { a: 5 } })).toEqual({ folder: DEFAULT_LAYOUT.folder, presets: [], snapshot: null }); });
 it('reports a failed import with its written paths', () => { const report = importReport(planImport(text), ['RemNote import/Plan.md'], 'disk full'); expect(report).toContain('Written notes: 1'); expect(report).toContain('Stopped. disk full'); });
 it('keeps a stable source ID in YAML', () => { const note = planImport('{"docs":[{"_id":"id:with#symbols","key":["A"]}]}').notes[0]!; expect(note.content).toContain('remnote_id:'); expect(note.content).toContain('id:with#symbols'); expect(note.path).toContain(stableTag('id:with#symbols')); });
});

describe('format safety', () => {
 it('preserves emphasis next to spaces', () => {
  const plan = planImport(JSON.stringify({ docs: [{ _id: 'a', key: ['A'], value: [{ i: 'm', text: '  important  ', b: true, it: true }] }] })); expect(plan.notes[0]!.content).toContain('  ***important***  ');
 });
 it('keeps Unicode code points intact when limiting a title', () => { const name = safeName('a'.repeat(69) + '😀'); expect(name).toBe('a'.repeat(69) + '😀'); });
 it('rejects extreme JSON nesting with a clear message', () => {
  let value: unknown = 'X'; for (let i = 0; i < 150; i++) value = [value];
  expect(() => planImport(JSON.stringify({ docs: [{ _id: 'a', key: value }] }))).toThrow('JSON nesting exceeds 100');
 });
 it('creates an unsupported-depth report for deeply nested rich text', () => {
  let value: unknown = 'X'; for (let i = 0; i < 25; i++) value = [value]; const plan = planImport(JSON.stringify({ docs: [{ _id: 'a', key: ['A'], value }] }));
  expect(plan.warnings.map(w => w.type)).toContain('rich-text-depth'); expect(plan.notes[0]!.content).toContain('[Unsupported depth]');
 });
 it('does not reinterpret HTML as an image or script', () => {
  const plan = planImport(JSON.stringify({ docs: [{ _id: 'a', key: ['A'], value: ['<script>alert(1)</script> ![image](https://example.invalid/x.png)'] }] }));
  expect(plan.notes[0]!.content).toContain('\\<script\\>'); expect(plan.notes[0]!.content).toContain('\\!\\[image\\]'); expect(plan.notes[0]!.content).not.toContain('\n<script>');
 });
 it('makes 25000 sibling nodes with parent links', () => {
  const docs = Array.from({ length: 25000 }, (_, i) => ({ _id: String(i), key: [`Node ${i}`], ...(i ? { parent: '0' } : {}) })); const plan = planImport(JSON.stringify({ docs })); expect(plan.notes).toHaveLength(25000); expect(plan.warnings).toHaveLength(0);
 }, 30000);
 it('keeps a successful import visible if saving the snapshot fails', async () => {
  const p = plugin(); vi.spyOn(p, 'saveSettings').mockRejectedValue(new Error('settings denied')); expect((await p.importText(text, DEFAULT_LAYOUT)).complete).toBe(true); expect(p.app.vault.getAbstractFileByPath('RemNote import/Import report.md')).toBeTruthy();
 });
});

describe('destination ownership', () => {
 it('does not write into a folder created after preflight', async () => {
  const plan = planImport(text); const create = vi.fn(); const createFolder = vi.fn(async () => { throw new Error('Folder already exists'); });
  const result = await writeImport({ getAbstractFileByPath: () => null, createFolder, create } as never, plan);
  expect(result).toMatchObject({ complete: false, written: [], reportWritten: false }); expect(result.error).toContain('already exists'); expect(create).not.toHaveBeenCalled();
 });
});
