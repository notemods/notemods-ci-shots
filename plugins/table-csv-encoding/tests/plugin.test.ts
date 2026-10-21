import { describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import { normalizePath, type Editor } from 'obsidian';
import type { SponsorsManager } from '../src/license/index';
import { encodeTableCsv, markdownCsvTables, csvFileStem } from '../src/core/index';
import vectors from './vectors/table-csv-encoding.json';
import { runAcceptanceCase } from './scenarios';
import TableCsvEncodingPlugin, { vaultFolder } from '../src/main';
import { ExportModal } from '../src/modals';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import manifest from '../manifest.json';

vi.mock('obsidian', async (importOriginal) => {
 const actual = await importOriginal<typeof import('obsidian')>();
 return { ...actual, normalizePath: (value: string) => actual.normalizePath(value) || '/' };
});

const source = '| Name | Value |\n| --- | --- |\n| Đặng | 你好 🙂 |\n';
const options = { delimiter: ',' as const, bom: true, headers: true };
function plugin(): TableCsvEncodingPlugin {
 const app = App.createConfigured__({ files: { 'Book/A.md': source, 'Book/Sub/A.md': source, 'Bookish/Skip.md': source, 'Book/A-table-1.csv': 'Keep me' } });
 const plugin = new TableCsvEncodingPlugin(app as never, manifest as never);
 return plugin;
}

describe('golden acceptance cases', () => {
 for (const test of vectors.cases) it(test.name, () => expect(runAcceptanceCase(test.args[0] as Parameters<typeof runAcceptanceCase>[0])).toEqual(test.expected));
});

describe('CSV files', () => {
 it.each(['> ', '> > ', '  > >'])('parses quote table rows with prefix %j', (prefix) => {
  const text = '> [!note] Export\n>\n' + source.trimEnd().split('\n').map((line) => prefix + line).join('\n') + '\n';
  expect(markdownCsvTables(text)).toEqual([{ line: 3, endLine: 5, rows: [['Name', 'Value'], ['Đặng', '你好 🙂']], problem: null }]);
  expect(encodeTableCsv(markdownCsvTables(text)[0]!.rows, options)).toBe('\uFEFFName,Value\r\nĐặng,你好 🙂\r\n');
 });
 it('keeps table boundaries at a quote depth change', () => {
  const text = '> | A | B |\n> | --- | --- |\n> | one | two |\n| Outside | prose |\n';
  expect(markdownCsvTables(text)[0]).toEqual({ line: 1, endLine: 3, rows: [['A', 'B'], ['one', 'two']], problem: null });
  expect(markdownCsvTables('| A | B |\n> | --- | --- |\n')).toEqual([]);
 });
 it('ignores quoted code tables and resumes after a quote container ends', () => {
  const quoted = '> ```md\n' + source.split('\n').map((line) => '> ' + line).join('\n');
  expect(markdownCsvTables(quoted)).toEqual([]);
  expect(markdownCsvTables(quoted + '\n' + source).map((table) => table.rows)).toEqual([[['Name', 'Value'], ['Đặng', '你好 🙂']]]);
 });
 it('reports the source line for a ragged callout table', () => {
  const text = '> [!note]\n>\n> | A | B |\n> | --- | --- |\n> | short |\n';
  expect(markdownCsvTables(text)[0]!.problem).toContain('Line 5 has 1 cells');
 });
 it('saves a callout table without changing the note', async () => {
  const p = plugin();
  const text = '> [!note]\n>\n' + source.trimEnd().split('\n').map((line) => '> ' + line).join('\n') + '\n';
  const file = await p.app.vault.create('Callout.md', text);
  const path = await p.saveTable({ getValue: () => text } as Editor, text, file, 0, 'Callout', options);
  expect(await p.app.vault.read(p.app.vault.getFileByPath(path)!)).toBe('\uFEFFName,Value\r\nĐặng,你好 🙂\r\n');
  expect(await p.app.vault.read(file)).toBe(text);
 });
 it('writes EF BB BF as the actual UTF-8 prefix', () => {
  const csv = encodeTableCsv([['Đặng','你好 🙂']], options);
  expect([...Buffer.from(csv, 'utf8').subarray(0, 3)]).toEqual([239, 187, 191]);
  expect(Buffer.from(csv, 'utf8').toString('utf8')).toBe(csv);
 });
 it('preserves cell text that begins with a formula marker', () => {
  expect(encodeTableCsv([['=1+1']], { ...options, bom: false })).toBe('=1+1\r\n');
 });
 it('keeps an existing file and chooses a new file name without Pro', async () => {
  const p = plugin();
  const file = p.app.vault.getFileByPath('Book/A.md')!;
  const path = await p.saveTable({ getValue: () => source } as Editor, source, file, 0, 'A-table-1', options);
  expect(path).toBe('Book/A-table-1-2.csv');
  expect(await p.app.vault.read(p.app.vault.getFileByPath('Book/A-table-1.csv')!)).toBe('Keep me');
  expect(await p.app.vault.read(p.app.vault.getFileByPath(path)!)).toBe('\uFEFFName,Value\r\nĐặng,你好 🙂\r\n');
  expect(await p.app.vault.read(file)).toBe(source);
 });
 it('refuses a source path change before creating a file', async () => {
  const p = plugin(); const create = vi.spyOn(p.app.vault, 'create');
  await expect(p.saveTable({ getValue: () => source } as Editor, source, p.app.vault.getFileByPath('Book/A.md')!, 0, 'Export', options, 'Book/Old.md')).rejects.toThrow('source note moved');
  expect(create).not.toHaveBeenCalled();
 });
 it('refuses a stale preview before creating a file', async () => {
  const p = plugin(); const create = vi.spyOn(p.app.vault, 'create');
  await expect(p.saveTable({ getValue: () => 'changed' } as Editor, source, p.app.vault.getFileByPath('Book/A.md')!, 0, 'Export', options)).rejects.toThrow('note changed');
  expect(create).not.toHaveBeenCalled();
 });
 it('refuses a ragged table before creating a file', async () => {
  const p = plugin(); const create = vi.spyOn(p.app.vault, 'create');
  const ragged = '| A | B |\n| --- | --- |\n| only |\n';
  await expect(p.saveTable({ getValue: () => ragged } as Editor, ragged, p.app.vault.getFileByPath('Book/A.md')!, 0, 'Export', options)).rejects.toThrow('Correct the row');
  expect(create).not.toHaveBeenCalled();
 });
 it('chooses the table at the cursor and shows a BOM preview without Pro', () => {
  const p = plugin();
  const text = source + '\n' + source;
  const modal = new ExportModal(p.app, p, { getValue: () => text, getCursor: () => ({ line: 6, ch: 0 }) } as Editor, p.app.vault.getFileByPath('Book/A.md')!);
  expect(modal.index).toBe(1);
  modal.onOpen();
  expect(modal.contentEl.textContent).toContain('EF BB BF');
  expect(modal.contentEl.textContent).toContain('Đặng,你好 🙂');
  modal.onClose();
 });
 it('rejects dot segments in output paths', () => {
  expect(() => vaultFolder('../outside')).toThrow('dot segments');
  expect(vaultFolder('Book\\Sub/')).toBe('Book/Sub');
 });
 it('caps Unicode names by UTF-8 bytes without cutting a character', () => {
  const name = csvFileStem('🙂'.repeat(100));
  expect(Buffer.byteLength(name, 'utf8')).toBe(180);
  expect([...name]).toHaveLength(45);
 });
});

describe('Pro batch', () => {
 function paid(): TableCsvEncodingPlugin { const p = plugin(); p.pro = { isPro: () => true } as SponsorsManager; return p; }
 it('denies preparation before reading source files', async () => {
  const p = plugin(); const read = vi.spyOn(p.app.vault, 'read');
  await expect(p.prepareBatch('Book', options)).rejects.toThrow('Pro is required');
  expect(read).not.toHaveBeenCalled();
 });
 it.each(['', '/', ' / '])('prepares the vault root for %j with the real root normalization', async (input) => {
  expect(normalizePath('')).toBe('/');
  const p = paid();
  await p.app.vault.create('Root.md', source);
  const plan = await p.prepareBatch(input, options);
  expect(plan.folder).toBe('');
  expect(plan.sources.map((s) => s.file.path)).toEqual(['Book/A.md', 'Book/Sub/A.md', 'Bookish/Skip.md', 'Root.md']);
 });
 it('saves a root note beside its source with the real root normalization', async () => {
  const p = plugin();
  const file = await p.app.vault.create('Root.md', source);
  expect(await p.saveTable({ getValue: () => source } as Editor, source, file, 0, 'Root-table-1', options)).toBe('Root-table-1.csv');
 });
 it('prepares a folder and subfolders without writing files', async () => {
  const p = paid(); const create = vi.spyOn(p.app.vault, 'create');
  const plan = await p.prepareBatch('Book', options);
  expect(plan.sources.map((s) => s.file.path)).toEqual(['Book/A.md','Book/Sub/A.md']);
  expect(plan.sources.flatMap((s) => s.outputs.map((o) => o.name))).toEqual(['A-table-1.csv','Sub__A-table-1.csv']);
  expect(create).not.toHaveBeenCalled();
 });
 it('writes the prepared snapshot into a fresh folder', async () => {
  const p = paid(); const plan = await p.prepareBatch('Book', options);
  const folder = await p.writeBatch(plan);
  const file = p.app.vault.getFileByPath(folder + '/A-table-1.csv')!;
  expect(await p.app.vault.read(file)).toContain('Đặng,你好 🙂');
  expect(await p.app.vault.read(p.app.vault.getFileByPath('Book/A.md')!)).toBe(source);
 });
 it('blocks a changed source before making a folder', async () => {
  const p = paid(); const plan = await p.prepareBatch('Book', options);
  await p.app.vault.modify(p.app.vault.getFileByPath('Book/A.md')!, 'changed');
  const create = vi.spyOn(p.app.vault, 'createFolder');
  await expect(p.writeBatch(plan)).rejects.toThrow('source note changed');
  expect(create).not.toHaveBeenCalled();
 });
 it('denies a signed-out write', async () => {
  const p = paid(); const plan = await p.prepareBatch('Book', options); p.pro = null;
  await expect(p.writeBatch(plan)).rejects.toThrow('Pro is required');
 });
 it('bounds retained batch snapshots before writing files', async () => {
  const large = 'x'.repeat(1800000) + '\n\n' + source;
  const app = App.createConfigured__({ files: { 'Book/1.md': large, 'Book/2.md': large, 'Book/3.md': large, 'Book/4.md': large, 'Book/5.md': large } });
  const p = new TableCsvEncodingPlugin(app as never, manifest as never);
  p.pro = { isPro: () => true } as SponsorsManager;
  const create = vi.spyOn(p.app.vault, 'create');
  await expect(p.prepareBatch('Book', options)).rejects.toThrow('8,388,608 source characters');
  expect(create).not.toHaveBeenCalled();
 });
 it('cancels preparation before a source read', async () => {
  const p = paid(); const read = vi.spyOn(p.app.vault, 'read');
  await expect(p.prepareBatch('Book', options, () => true)).rejects.toThrow('cancelled');
  expect(read).not.toHaveBeenCalled();
 });
});

describe('settings', () => {
 it('repairs bad saved types', () => {
  expect(normalizeSettings({ bom: 0 as never, delimiter: '|' as never, headers: null as never })).toEqual(DEFAULT_SETTINGS);
 });
 it('loads defaults from an in-memory vault', async () => {
  const p = plugin(); await p.loadSettings(); expect(p.settings).toEqual(DEFAULT_SETTINGS);
 });
 it('finds no table in ordinary prose', () => expect(markdownCsvTables('A note without a table.')).toEqual([]));
});
