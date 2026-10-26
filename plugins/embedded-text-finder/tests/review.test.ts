import { afterEach, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import * as obsidian from 'obsidian';
import Finder from '../src/main';
import manifest from '../manifest.json';
import { parseDocument, search, type SearchStore } from '../src/search';
import { vaultStore } from '../src/store';
import { resetPro } from '../src/pro';

vi.mock('obsidian', async (original) => ({...await original<typeof obsidian>(), resolveSubpath: vi.fn()}));

afterEach(() => { vi.restoreAllMocks(); resetPro(); });

it.each([
 'Before `example\n![[Source]]\nend` after',
 'Before ``example ` ![[Source]] ` end`` after',
])('does not expand code spans: %s', (text) => {
 expect(parseDocument(text).embeds).toEqual([]);
});

it('keeps an embed after an unmatched two-backtick delimiter', () => {
 expect(parseDocument('Before `` unmatched ![[Source]]').embeds.map(e => e.link)).toEqual(['Source']);
});

it('does not treat a longer backtick run as the end of a code span', () => {
 expect(parseDocument('Before ` example `` ![[Source]] end`').embeds).toEqual([]);
});

it('does not return a complete search after cancellation during the last read', async () => {
 let finish!: (text: ReturnType<typeof parseDocument>) => void;
 let cancelled = false;
 const store: SearchStore = {
  paths: () => ['A.md'], read: () => new Promise(resolve => { finish = resolve; }),
  resolve: () => null, region: async () => null,
 };
 const pending = search(store, { folder: '', query: 'bird', cancelled: () => cancelled });
 cancelled = true; finish(parseDocument('bird'));
 const result = await pending;
 expect(result.cancelled).toBe(true);
 expect(result.matches).toEqual([]);
 expect(result.scanned).toBe(0);
});

it('rejects a stale block ID that is now only a prefix of another ID', async () => {
 const app = App.createConfigured__({files: {'Source.md': 'blue bird ^reference'}});
 const file = app.vault.getMarkdownFiles()[0]!;
 vi.spyOn(app.metadataCache, 'getFileCache').mockReturnValue({});
 vi.mocked(obsidian.resolveSubpath).mockReturnValue({
  type: 'block', start: {line: 0, col: 0, offset: 0}, end: {line: 0, col: 14, offset: 14},
  block: {id: 'ref', position: {start: {line: 0, col: 0, offset: 0}, end: {line: 0, col: 14, offset: 14}}},
 });
 const result = await vaultStore(app as never, [file] as never).region(file.path, '#^ref', 'blue bird ^reference');
 expect(result).toBeNull();
});

it('rejects a stale paragraph start after a paragraph is split before its ID', async () => {
 const text = 'wrong bird\n\nright ^ref';
 const app = App.createConfigured__({files: {'Source.md': text}});
 const file = app.vault.getMarkdownFiles()[0]!;
 vi.spyOn(app.metadataCache, 'getFileCache').mockReturnValue({});
 vi.mocked(obsidian.resolveSubpath).mockReturnValue({
  type: 'block', start: {line: 0, col: 0, offset: 0}, end: {line: 0, col: text.length, offset: text.length},
  block: {id: 'ref', position: {start: {line: 0, col: 0, offset: 0}, end: {line: 0, col: text.length, offset: text.length}}},
 });
 expect(await vaultStore(app as never, [file] as never).region(file.path, '#^ref', text)).toBeNull();
});

it.each([
 ['blue bird ^ref', 14],
 ['blue bird ^ref', 9],
 ['blue bird\n\n^ref', 9],
])('accepts a current block marker in %s at offset %s', async (text, end) => {
 const app = App.createConfigured__({files: {'Source.md': text}});
 const file = app.vault.getMarkdownFiles()[0]!;
 vi.spyOn(app.metadataCache, 'getFileCache').mockReturnValue({});
 vi.mocked(obsidian.resolveSubpath).mockReturnValue({
  type: 'block', start: {line: 0, col: 0, offset: 0}, end: {line: 0, col: end, offset: end},
  block: {id: 'ref', position: {start: {line: 0, col: 0, offset: 0}, end: {line: 0, col: end, offset: end}}},
 });
 expect(await vaultStore(app as never, [file] as never).region(file.path, '#^ref', text)).toEqual({start: 0, end});
});

it('does not start a refresh or timer after unload before layout ready', async () => {
 const app = App.createConfigured__({files: {}});
 let ready!: () => void;
 vi.spyOn(app.workspace, 'onLayoutReady').mockImplementation(callback => { ready = callback; });
 const p = new Finder(app as never, manifest as never);
 await p.onload();
 const refresh = vi.spyOn(p.pro!, 'refresh').mockResolvedValue();
 const interval = vi.spyOn(window, 'setInterval').mockReturnValue(42);
 p.onunload(); ready();
 expect(refresh).not.toHaveBeenCalled();
 expect(interval).not.toHaveBeenCalled();
});

it('handles an empty vault', async () => {
 const p = new Finder(App.createConfigured__({files: {}}) as never, manifest as never);
 expect(await p.runSearch({folder: '', query: 'bird'})).toEqual({matches: [], diagnostics: [], scanned: 0, cancelled: false});
});

it('does not read a repeated missing section again for each duplicate embed', async () => {
 const region = vi.fn(async () => null);
 const store: SearchStore = {
  paths: () => ['A.md'],
  read: async path => parseDocument(path === 'A.md' ? '![[B#Missing]]\n'.repeat(1000) : 'bird'),
  resolve: () => ({path: 'B.md', subpath: '#Missing'}), region,
 };
 const result = await search(store, {folder: '', query: 'bird', yield: async () => {}});
 expect(result.diagnostics).toHaveLength(1);
 expect(region).toHaveBeenCalledTimes(1);
});

it('does not register resources if unload occurs during settings load', async () => {
 const p = new Finder(App.createConfigured__({files: {}}) as never, manifest as never);
 let finish!: (data: unknown) => void;
 vi.spyOn(p, 'loadData').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
 const pending = p.onload();
 p.onunload(); finish({}); await pending;
 expect(p.pro).toBeNull();
});

it('does not turn masked code into literal spaces in a query', async () => {
 const store: SearchStore = {
  paths: () => ['A.md'], read: async () => parseDocument('blue `x` bird\nblue     bird'),
  resolve: () => null, region: async () => null,
 };
 const result = await search(store, {folder: '', query: 'blue     bird'});
 expect(result.matches).toHaveLength(1);
 const onlyCode = {...store, read: async () => parseDocument('blue `x` bird')};
 expect((await search(onlyCode, {folder: '', query: 'blue     bird'})).matches).toEqual([]);
});
