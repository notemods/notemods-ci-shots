import { afterEach, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import * as obsidian from 'obsidian';
import Finder from '../src/main';
import manifest from '../manifest.json';
import { bindPro, resetPro } from '../src/pro';
import { exportResults, parseDocument, search, type SearchStore } from '../src/search';
import { normalizeSettings } from '../src/settings';

// Obsidian returns '/' for an empty path. The mock returns ''.
vi.mock('obsidian', async (original) => {
 const real = await original<typeof obsidian>();
 return {...real, normalizePath: (path: string) => real.normalizePath(path) || '/'};
});

afterEach(resetPro);

it('does not let a code span cross a blank line', () => {
 const text = 'Press the ` key.\n\n![[Source]]\n\nThe other ` key.';
 expect(parseDocument(text).embeds.map((e) => e.link)).toEqual(['Source']);
 expect(parseDocument('A `code\nspan` and ![[Source]]').embeds.map((e) => e.link)).toEqual(['Source']);
});

it('finds body text between stray backticks in different paragraphs', async () => {
 const store: SearchStore = {
  paths: () => ['A.md'], read: async () => parseDocument('Press the ` key.\n\nblue bird\n\nThe other ` key.'),
  resolve: () => null, region: async () => null,
 };
 expect((await search(store, {folder: '', query: 'blue bird', yield: async () => {}})).matches).toHaveLength(1);
});

it('escapes math, highlight and comment markers in exported excerpts', () => {
 const text = exportResults({matches: [{container: 'A.md', source: 'B.md', subpath: '', depth: 1, excerpt: 'costs $5 and $10 ==hi== %%x &amp;'}], diagnostics: [], scanned: 1, cancelled: false}, '$q$');
 expect(text).toContain('costs \\$5 and \\$10 \\=\\=hi\\=\\= \\%\\%x \\&amp;');
 expect(text).toContain('Query: \\$q\\$');
});

it('keeps the vault root as an empty folder in presets', async () => {
 bindPro({isPro: () => true, onChange: () => () => {}} as never);
 const p = new Finder(App.createConfigured__({files: {}}) as never, manifest as never);
 await p.savePreset('Root', '', 'blue bird');
 expect(p.settings.presets).toEqual([{name: 'Root', folder: '', query: 'blue bird'}]);
 expect(normalizeSettings({presets: [{name: 'Old', folder: '/', query: 'x'}]}).presets[0]?.folder).toBe('');
});
