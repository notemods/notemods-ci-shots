import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId, reloadPlugin } from './load';
describe(`${pluginId} integration`, function () {
 it('is enabled and reloads without errors', async function () {
  expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] });
 });
 it('drags a row, persists its numeric rank and restores the order on reopen', async function () {
  await obsidianPage.write('Order A.md', '---\nmanual_order: 1024\nstatus: draft\n---\nBody A');
  await obsidianPage.write('Order B.md', '---\nmanual_order: 2048\nstatus: draft\n---\nBody B');
  await obsidianPage.write('Order C.md', '---\nmanual_order: 3072\nstatus: draft\n---\nBody C');
  await obsidianPage.write('Order.base', 'filters: \'file.name.startsWith("Order ")\'\nviews:\n  - type: bases-manual-order\n    name: Queue\n    order: [file.name, note.manual_order]\n');
  await obsidianPage.openFile('Order.base');
  await browser.waitUntil(async()=> await browser.$$('.bmo-view tbody tr').length === 3, {timeout:15000});
  await browser.execute(()=>{
   const rows=Array.from(document.querySelectorAll<HTMLElement>('.bmo-view tbody tr'));
   const from=rows.find(row=>row.dataset.path==='Order C.md')!;
   const to=rows.find(row=>row.dataset.path==='Order B.md')!;
   const dataTransfer=new DataTransfer();
   from.querySelector('[draggable]')!.dispatchEvent(new DragEvent('dragstart',{dataTransfer,bubbles:true}));
   to.dispatchEvent(new DragEvent('drop',{dataTransfer,bubbles:true,cancelable:true}));
  });
  await browser.waitUntil(async()=> await browser.executeObsidian(({app})=> app.metadataCache.getFileCache(app.vault.getFileByPath('Order C.md')!)?.frontmatter?.manual_order === 1536), {timeout:10000});
  await obsidianPage.openFile('Order A.md');
  await obsidianPage.openFile('Order.base');
  await browser.waitUntil(async()=> await browser.$$('.bmo-view tbody tr').length === 3, {timeout:15000});
  const paths=await browser.execute(()=>Array.from(document.querySelectorAll<HTMLElement>('.bmo-view tbody tr')).map(row=>row.dataset.path));
  expect(paths).toEqual(['Order A.md','Order C.md','Order B.md']);
  const body=await browser.executeObsidian(async({app})=>app.vault.read(app.vault.getFileByPath('Order C.md')!));
  expect(body).toContain('Body C'); expect(body).toContain('status: draft');
 });
});
