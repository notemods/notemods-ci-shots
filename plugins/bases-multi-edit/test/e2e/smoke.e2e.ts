import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId, reloadPlugin } from './load';
const folder = 'Bulk edit checks';
const note = `${folder}/Alpha.md`;
async function click(text: string) {
 await browser.execute((label: string) => { const scope=document.querySelector('.bme-preview')?.closest('.modal')??document.querySelector('[data-bme-test="mixed"]')??document;const button = [...scope.querySelectorAll('button')].find(b => b.textContent === label); if (!button) throw new Error(`Missing button ${label}`); button.click(); }, text);
}
async function status() {
 return browser.executeObsidian(async ({app}, path: string) => { const f=app.vault.getFileByPath(path); if (!f) throw new Error('Missing test note'); return app.vault.read(f); }, note);
}
describe(`${pluginId} Bases editing`, function () {
 it('loads and reloads without console errors', async function () { expect(await reloadPlugin(pluginId)).toEqual({enabled:true,reloaded:true,errors:[]}); });
 it('selects a row, previews, applies and undoes a real frontmatter edit', async function () {
  await obsidianPage.write(note, '---\nstatus: todo\nowner: Mina\n---\nKeep the body.');
  await obsidianPage.write(`${folder}/Beta.md`, '---\nstatus: todo\n---\nLeave this alone.');
  await obsidianPage.write(`${folder}/Review.base`, `filters:\n  and:\n    - 'file.inFolder("${folder}")'\nviews:\n  - type: bases-multi-edit\n    name: Review\n    order:\n      - note.status\n`);
  await obsidianPage.openFile(`${folder}/Review.base`);
  await browser.$('.bme-table-view tbody input').waitForExist({timeout:15000});
  await browser.$(`input[aria-label="Select ${note}"]`).click();
  await click('Edit selected'); await click('Preview changes');
  await browser.$('.bme-preview pre').waitForExist();
  expect(await browser.$('.bme-preview pre').getText()).toContain('"todo" → "done"');
  await click('Apply to 1 note');
  await browser.waitUntil(async()=> (await status()).includes('status: done'));
  expect(await status()).toContain('owner: Mina');
  expect(await status()).toContain('Keep the body.');
  await click('Undo last batch');
  await browser.waitUntil(async()=> (await status()).includes('status: todo'));
 });
 it('does not overwrite a value changed after preview', async function () {
  await browser.keys('Escape');
  await browser.$('.bme-preview').waitForExist({reverse:true});
  await click('Edit selected'); await click('Preview changes');
  await browser.$('.bme-preview pre').waitForExist();
  await browser.executeObsidian(async ({app}, path:string)=> { const f=app.vault.getFileByPath(path); if(!f) throw Error('Missing note'); await app.fileManager.processFrontMatter(f, data=> {data.status='later';}); }, note);
  await click('Apply to 1 note');
  await browser.waitUntil(async()=> (await browser.$('.bme-preview').getText()).includes('1 skipped'));
  expect(await status()).toContain('status: later');
 });
 it('reopens a Bases tab after a plugin reload',async function(){
  await browser.keys('Escape');
  await browser.$('.bme-preview').waitForExist({reverse:true});
  expect(await reloadPlugin(pluginId)).toEqual({enabled:true,reloaded:true,errors:[]});
  await browser.$('.bme-table-view tbody input').waitForExist({timeout:15000});
  expect(await browser.$('.bme-table-view').getText()).toContain('0 of 2 selected');
 });

 it('appends and removes across empty, scalar and list properties while skipping an incompatible note',async function(){
  const dir='Mixed list checks';
  const originals:Record<string,string>={Empty:'tags:',Scalar:'Tags: project',List:'tags: [project]',Invalid:'tags: {nested: value}'};
  for(const [name,yaml] of Object.entries(originals)) await obsidianPage.write(`${dir}/${name}.md`,`---\n${yaml}\n# YAML comment before editing\nowner: Mina\n---\nKeep this body.`);
  await obsidianPage.write(`${dir}/Review.base`,`filters:\n  and:\n    - 'file.inFolder("${dir}")'\nviews:\n  - type: bases-multi-edit\n    name: Mixed\n    order:\n      - note.tags\n`);
  await obsidianPage.openFile(`${dir}/Review.base`);
  await browser.$('.bme-table-view tbody input').waitForExist({timeout:15000});
  await browser.waitUntil(async()=> browser.execute(()=>{
   const root=document.querySelector('input[aria-label="Select Mixed list checks/Empty.md"]')?.closest('.bme-table-view');
   if(!root)return false;root.setAttribute('data-bme-test','mixed');return root.querySelectorAll('tbody input').length===4;
  }),{timeout:15000,timeoutMsg:'Mixed list table must contain four notes'});
  await click('Select visible');await click('Edit selected');
  for(const operation of ['append','remove-items']) {
   await browser.execute((op:string)=>{
    for(const [name,value] of Object.entries({Property:'tags',Operation:op,'Value type':'list',Value:op==='append'?'["review"]':'["project"]'})) {
     const row=[...document.querySelectorAll('.modal .setting-item')].find(el=>el.querySelector('.setting-item-name')?.textContent===name);
     const input=row?.querySelector<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('input,select,textarea');
     if(!input)throw Error(`Missing ${name}`);input.value=value;input.dispatchEvent(new Event(input.tagName==='SELECT'?'change':'input',{bubbles:true}));
    }
   },operation);
   await click('Preview changes');await browser.$('.bme-preview pre').waitForExist();
   expect(await browser.$('.bme-preview').getText()).toContain('YAML comments');
   expect(await browser.$('.bme-preview pre').getText()).toContain('Invalid.md: skipped:');
   await click('Apply to 3 notes');
   await browser.waitUntil(async()=> (await browser.$('.bme-preview').getText()).includes('3 notes changed'));
   const result=await browser.executeObsidian(async({app},dir:string)=>{
    const out:Record<string,{body:string}>={};
    for(const name of ['Empty','Scalar','List','Invalid']){
     const file=app.vault.getFileByPath(`${dir}/${name}.md`);if(!file)throw Error('Missing note');
     out[name]={body:await app.vault.read(file)};
    }return out;
   },dir);
   // Wait for the disk writes; inspect the actual YAML as well as preserving body text.
   expect(result.Empty!.body).toContain(operation==='append'?'review':'tags: []');
   expect(result.Scalar!.body).toContain('Tags:');expect(result.Scalar!.body).not.toMatch(/\ntags:/);
   if(operation==='append'){expect(result.Scalar!.body).toContain('project');expect(result.List!.body).toContain('project');}else{expect(result.Scalar!.body).not.toContain('project');expect(result.List!.body).not.toContain('project');}
   expect(result.Invalid!.body).toContain('tags: {nested: value}');
   for(const value of Object.values(result)){expect(value.body).toContain('Keep this body.');expect(value.body).toContain('owner: Mina');}
   await browser.execute(()=>{const button=document.querySelector<HTMLButtonElement>('.bme-preview button');if(!button)throw Error('Missing undo');button.click();});
   await browser.waitUntil(async()=> (await browser.$('.bme-preview').getText()).includes('3 notes restored'));
   const restored=await browser.executeObsidian(async({app},dir:string)=>{
    const out:Record<string,string>={};for(const name of ['Empty','Scalar','List']){const f=app.vault.getFileByPath(`${dir}/${name}.md`);if(!f)throw Error('Missing note');out[name]=await app.vault.read(f);}return out;
   },dir);
   expect(restored.Empty!).toMatch(/tags:\s*\n/);expect(restored.Scalar!).toContain('Tags: project');expect(restored.List!).toContain('project');
  }
  await browser.keys('Escape');
  await browser.$('.bme-preview').waitForExist({reverse:true});
 });

});
