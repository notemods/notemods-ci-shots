import { describe, expect, it, vi } from 'vitest';
import { ManualOrderView, RankConfirmModal } from '../src/view';
import { App } from 'obsidian-test-mocks/obsidian';
import { resetPro } from '../src/pro';
function fixture(ranks: unknown[] = [1024, 2048, 3072]) {
 resetPro();
 const notes = ranks.map((rank,i)=>({file:{path:`${i}.md`, basename:`${i}`, extension:'md'}, frontmatter:{manual_order:rank, status:'draft'}}));
 const update = vi.fn();
 const process = vi.fn(async (file: {path:string}, callback:(fm:Record<string,unknown>)=>void) => {
  callback(notes.find(n=>n.file.path===file.path)!.frontmatter);
 });
 const view = Object.create(ManualOrderView.prototype) as ManualOrderView;
 Object.assign(view, {
  busy:false, root:document.createElement('div'), onDataUpdated:update,
  config:{get:()=>undefined, getOrder:()=>[]}, data:{data:notes,groupedData:[{entries:notes,hasKey:()=>false}]},
  app:{metadataCache:{getFileCache:(file:{path:string})=>notes.find(n=>n.file.path===file.path)}, vault:{getFileByPath:(path:string)=>notes.find(n=>n.file.path===path)?.file}, fileManager:{processFrontMatter:process}},
 });
 return {view,notes,process,update, root:(view as unknown as {root:HTMLElement}).root};
}
describe('write orchestration',()=>{
 it('writes the rank through frontmatter and preserves another property',async()=>{
  const f=fixture(); await f.view.move(0,'2.md','1.md','manual_order');
  expect(f.process).toHaveBeenCalledTimes(1); expect(f.notes[2]!.frontmatter).toEqual({manual_order:1536,status:'draft'}); expect(f.update).toHaveBeenCalled();
 });
 it('rejects a stale property without writes',async()=>{
  const f=fixture(); await f.view.move(0,'2.md','1.md','other'); expect(f.process).not.toHaveBeenCalled();
 });
 it('rejects a missing group',async()=>{
  const f=fixture(); await f.view.move(4,'2.md','1.md','manual_order'); expect(f.process).not.toHaveBeenCalled();
 });
 it('does not write hidden notes or a second group',async()=>{
  const f=fixture(); const hidden={file:{path:'hidden.md'},frontmatter:{manual_order:999}};
  (f.view.data.groupedData as unknown[]).push({entries:[hidden]});
  await f.view.move(0,'2.md','1.md','manual_order'); expect(hidden.frontmatter.manual_order).toBe(999); expect(f.process).toHaveBeenCalledTimes(1);
 });
 it('stops a rebalance at the first failed write',async()=>{
  const f=fixture([null,null,null]); f.process.mockRejectedValueOnce(new Error('disk write failed'));
  await f.view.move(0,'2.md','0.md','manual_order'); expect(f.process).toHaveBeenCalledTimes(1); expect(f.update).toHaveBeenCalled();
 });
 it('rejects non-Markdown files before writing any rank',async()=>{
  const f=fixture(); f.notes[2]!.file.extension='pdf'; await f.view.move(0,'2.md','1.md','manual_order'); expect(f.process).not.toHaveBeenCalled();
 });
 it('prevents overlapping moves while a write is pending',async()=>{
  const f=fixture(); let finish:(()=>void) | undefined;
  f.process.mockImplementationOnce(async()=>{await new Promise<void>(resolve=>{finish=resolve;});});
  const first=f.view.move(0,'2.md','1.md','manual_order');
  await f.view.move(0,'1.md','0.md','manual_order'); expect(f.process).toHaveBeenCalledTimes(1); finish?.(); await first;
 });
 it('preserves a rank edited after planning and before the write callback',async()=>{
  const f=fixture();
  f.process.mockImplementationOnce(async(file,callback)=>{
   const note=f.notes.find(n=>n.file.path===file.path)!;
   note.frontmatter.manual_order=42; callback(note.frontmatter);
  });
  await f.view.move(0,'2.md','1.md','manual_order');
  expect(f.notes[2]!.frontmatter.manual_order).toBe(42); expect(f.process).toHaveBeenCalledTimes(1);
 });
 it('restores a completed numeric rank after a mid-rebalance failure',async()=>{
  const f=fixture([1,1,2]);
  f.process.mockImplementationOnce(async(file,callback)=>callback(f.notes.find(n=>n.file.path===file.path)!.frontmatter));
  f.process.mockRejectedValueOnce(new Error('second write failed'));
  await f.view.move(0,'2.md','0.md','manual_order');
  expect(f.process).toHaveBeenCalledTimes(3); expect(f.notes.map(n=>n.frontmatter.manual_order)).toEqual([1,1,2]);
 });
 it('allows another move after a failed write releases the busy state',async()=>{
  const f=fixture(); f.process.mockRejectedValueOnce(new Error('temporary error'));
  await f.view.move(0,'2.md','1.md','manual_order');
  await f.view.move(0,'2.md','1.md','manual_order');
  expect(f.notes[2]!.frontmatter.manual_order).toBe(1536); expect(f.process).toHaveBeenCalledTimes(2);
 });
 it('does not overwrite a nonnumeric frontmatter value',async()=>{
  const f=fixture([1024,2048,'keep me']);
  await f.view.move(0,'2.md','1.md','manual_order');
  expect(f.process).not.toHaveBeenCalled(); expect(f.notes[2]!.frontmatter.manual_order).toBe('keep me');
 });

});

describe('review regressions', () => {
 it('moves Markdown notes when an unranked attachment shares the group', async () => {
  const f=fixture([100,200,undefined]); f.notes[2]!.file.extension='pdf';
  await f.view.move(0,'1.md','0.md','manual_order');
  expect(f.process).toHaveBeenCalledTimes(1); expect(f.notes[1]!.frontmatter.manual_order).toBe(-924);
  expect(f.notes[2]!.frontmatter.manual_order).toBeUndefined();
 });
 it('renders attachments without move controls and keeps the last Markdown down button disabled', () => {
  const f=fixture(); f.notes[2]!.file.extension='pdf';
  ManualOrderView.prototype.onDataUpdated.call(f.view);
  expect(f.root.querySelector('[data-path="2.md"] button')).toBeNull();
  expect(f.root.querySelector<HTMLButtonElement>('[aria-label="Move 1 down"]')!.disabled).toBe(true);
  expect(f.root.querySelector('[draggable]')!.getAttribute('tabindex')).toBe('-1');
  expect(f.root.querySelector('a')!.getAttribute('data-href')).toBe('0.md');
 });
 it('keeps a custom property read-only when Pro is off', async () => {
  const f=fixture(); f.view.config.get=()=> 'custom_order';
  ManualOrderView.prototype.onDataUpdated.call(f.view);
  expect(f.root.textContent).toContain('read-only'); expect(f.root.querySelector('button')).toBeNull();
  await f.view.move(0,'2.md','0.md','custom_order'); expect(f.process).not.toHaveBeenCalled();
 });
 it('does not rewrite a large ordered queue when one new note has no rank', async () => {
  const f=fixture([...Array.from({length:200},(_,i)=>i+1),undefined]);
  const confirm=vi.spyOn(f.view,'confirmMove');
  await f.view.move(0,'1.md','0.md','manual_order');
  expect(f.process).toHaveBeenCalledTimes(2); expect(confirm).not.toHaveBeenCalled();
  expect(f.notes[200]!.frontmatter.manual_order).toBe(1224);
  expect(f.notes.slice(2,200).map(n=>n.frontmatter.manual_order)).toEqual(Array.from({length:198},(_,i)=>i+3));
 });
 it('requires approval before writing more than ten notes', async () => {
  const f=fixture(Array(11).fill(1)); let approve:((v:boolean)=>void) | undefined;
  const confirm=vi.spyOn(f.view,'confirmMove').mockImplementation(()=>new Promise(resolve=>{approve=resolve;}));
  const move=f.view.move(0,'10.md','0.md','manual_order');
  expect(confirm).toHaveBeenCalledWith(11); expect(f.process).not.toHaveBeenCalled();
  approve!(true); await move; expect(f.process).toHaveBeenCalledTimes(11);
 });
 it('cancels a large move without writing any notes', async () => {
  const f=fixture(Array(11).fill(1)); vi.spyOn(f.view,'confirmMove').mockResolvedValue(false);
  await f.view.move(0,'10.md','0.md','manual_order'); expect(f.process).not.toHaveBeenCalled();
 });
 it('does not require approval for ten writes', async () => {
  const f=fixture(Array(10).fill(1)); const confirm=vi.spyOn(f.view,'confirmMove');
  await f.view.move(0,'9.md','0.md','manual_order'); expect(confirm).not.toHaveBeenCalled(); expect(f.process).toHaveBeenCalledTimes(10);
 });
 it('restores an absent rank by deleting the newly created property', async () => {
  const f=fixture([undefined,undefined,undefined]);
  delete (f.notes[2]!.frontmatter as Record<string,unknown>).manual_order;
  f.process.mockImplementationOnce(async(file,callback)=>callback(f.notes.find(n=>n.file.path===file.path)!.frontmatter));
  f.process.mockRejectedValueOnce(new Error('write failed'));
  await f.view.move(0,'2.md','0.md','manual_order');
  expect(Object.prototype.hasOwnProperty.call(f.notes[2]!.frontmatter,'manual_order')).toBe(false);
 });
 it('preserves a concurrent edit during rollback and continues restoring earlier notes', async () => {
  const f=fixture([1,1,2,3]);
  const apply=async(file:{path:string},callback:(fm:Record<string,unknown>)=>void)=>callback(f.notes.find(n=>n.file.path===file.path)!.frontmatter);
  f.process.mockImplementationOnce(apply).mockImplementationOnce(apply).mockImplementationOnce(async()=>{
   f.notes[0]!.frontmatter.manual_order=42; throw new Error('conflict');
  });
  await f.view.move(0,'2.md','0.md','manual_order');
  expect(f.notes[0]!.frontmatter.manual_order).toBe(42); expect(f.notes[2]!.frontmatter.manual_order).toBe(2);
 });
 it('shows the number of notes and treats closing the confirmation as cancellation', () => {
  const done=vi.fn(); const modal=new RankConfirmModal(App.createConfigured__(),11,done);
  modal.onOpen(); expect(modal.contentEl.textContent).toContain('11 notes');
  modal.onClose(); expect(done).toHaveBeenCalledWith(false);
 });
});
