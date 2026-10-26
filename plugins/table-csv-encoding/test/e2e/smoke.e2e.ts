import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { lastNotice, pluginId, reloadPlugin } from './load';

const source = '# Unicode\n\n| Name | Value |\n| --- | --- |\n| Đặng | 你好 🙂 |\n';
const editorText = async (): Promise<string> => browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.getValue() ?? '');

describe(`${pluginId} real app`, function () {
 it('enables and reloads without captured errors', async function () {
  expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] });
 });
 it('saves Unicode CSV with actual EF BB BF bytes and keeps the source intact', async function () {
  await obsidianPage.write('Unicode.md', source); await obsidianPage.openFile('Unicode.md');
  await browser.executeObsidianCommand(`${pluginId}:export-table-csv`);
  await expect(browser.$('.table-csv-modal')).toBeDisplayed();
  await expect(browser.$('.table-csv-summary')).toHaveText(expect.stringContaining('EF BB BF'));
  await browser.$('button=Save CSV file').click();
  await browser.waitUntil(async () => browser.executeObsidian(({ app }) => !!app.vault.getFileByPath('Unicode-table-1.csv')), { timeout: 5000 });
  const saved = await browser.executeObsidian(async ({ app }) => {
   const file = app.vault.getFileByPath('Unicode-table-1.csv'); if (!file) throw new Error('No CSV output');
   return { text: await app.vault.read(file), bytes: Array.from(new Uint8Array(await app.vault.readBinary(file))) };
  });
  expect(saved.bytes.slice(0, 3)).toEqual([239,187,191]);
  expect(Buffer.from(saved.bytes).toString('utf8')).toBe('\uFEFFName,Value\r\nĐặng,你好 🙂\r\n');
  expect(saved.text).toBe('Name,Value\r\nĐặng,你好 🙂\r\n');
  expect(await editorText()).toBe(source);
 });
 it('refuses a stale preview', async function () {
  await browser.executeObsidianCommand(`${pluginId}:export-table-csv`);
  await browser.executeObsidian(({ app }) => { app.workspace.activeEditor?.editor?.replaceRange('Changed\n', {line:0,ch:0}); });
  await browser.$('button=Save CSV file').click();
  await browser.waitUntil(async () => (await lastNotice()).includes('note changed'), { timeout: 5000 });
  await browser.keys('Escape');
 });
 it('guards the folder batch without a Pro session', async function () {
  const before = await editorText();
  await browser.executeObsidianCommand(`${pluginId}:export-folder-csv`);
  await browser.waitUntil(async () => (await lastNotice()).includes('pro feature'), { timeout: 5000 });
  expect(await editorText()).toBe(before);
 });
 it('scans the empty folder path and exports callout and Vietnamese tables without source edits', async function () {
  const actual = await browser.executeObsidian(async ({ app, obsidian }) => {
   type Batch = { folder: string; sources: { file: { path: string }; outputs: { name: string }[] }[] };
   const p = (app as unknown as { plugins: { plugins: Record<string, {
    pro: { isPro(): boolean };
    prepareBatch(path: string, options: { delimiter: ','; bom: boolean; headers: boolean }): Promise<Batch>;
    writeBatch(batch: Batch): Promise<string>;
   }> } }).plugins.plugins['table-csv-encoding']!;
   const notes = [
    { path: 'F1 Vietnamese.md', text: '| Tên | Thành phố |\n| --- | --- |\n| Nguyễn Ánh | Hồ Chí Minh |\n', csv: '\uFEFFTên,Thành phố\r\nNguyễn Ánh,Hồ Chí Minh\r\n' },
    { path: 'F1/Callout.md', text: '> [!note] Bảng\n>\n> | Tên | Giá trị |\n> | --- | --- |\n> | Đặng | Tiếng Việt 🙂 |\n', csv: '\uFEFFTên,Giá trị\r\nĐặng,Tiếng Việt 🙂\r\n' },
   ];
   await app.vault.createFolder('F1');
   for (const note of notes) await app.vault.create(note.path, note.text);
   const original = p.pro.isPro;
   p.pro.isPro = () => true;
   try {
    const batch = await p.prepareBatch('', { delimiter: ',', bom: true, headers: true });
    const folder = await p.writeBatch(batch);
    const outputs = [];
    for (const note of notes) {
     const prepared = batch.sources.find((source) => source.file.path === note.path);
     if (!prepared?.outputs[0]) throw new Error('Root scan missed ' + note.path);
     const file = app.vault.getFileByPath(folder + '/' + prepared.outputs[0].name);
     const source = app.vault.getFileByPath(note.path);
     if (!file || !source) throw new Error('Missing file for ' + note.path);
     const bytes = Array.from(new Uint8Array(await app.vault.readBinary(file)));
     outputs.push({ path: note.path, bytes, expected: note.csv, unchanged: await app.vault.read(source) === note.text });
    }
    return { normalizedRoot: obsidian.normalizePath(''), folderScope: batch.folder, outputs };
   } finally { p.pro.isPro = original; }
  });
  expect(actual.normalizedRoot).toBe('/');
  expect(actual.folderScope).toBe('');
  expect(actual.outputs).toHaveLength(2);
  for (const output of actual.outputs) {
   expect(output.bytes.slice(0, 3)).toEqual([239,187,191]);
   expect(Buffer.from(output.bytes).toString('utf8')).toBe(output.expected);
   expect(output.unchanged).toBe(true);
  }
 });
});
