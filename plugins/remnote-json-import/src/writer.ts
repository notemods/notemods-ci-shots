import { TFolder, normalizePath, type Vault } from 'obsidian';
import { importReport, type ImportPlan } from './importer';

export interface WriteResult { written: string[]; complete: boolean; error?: string; reportWritten: boolean }
/** Writes only into a new folder. A failure keeps written notes and attempts a report. */
export async function writeImport(vault: Pick<Vault, 'getAbstractFileByPath' | 'createFolder' | 'create'>, plan: ImportPlan): Promise<WriteResult> {
 const parts = plan.folder.split('/');
 if (vault.getAbstractFileByPath(plan.folder)) throw new Error('The destination exists. Use a new folder.');
 for (let i = 1; i < parts.length; i++) {
  const path = parts.slice(0, i).join('/'); const found = vault.getAbstractFileByPath(path);
  if (found && !(found instanceof TFolder)) throw new Error(`A file blocks the folder ${path}.`);
 }
 const written: string[] = [];
 let error: string | undefined;
 let ownedFolder = false;
 try {
  for (let i = 1; i < parts.length; i++) {
   const path = normalizePath(parts.slice(0, i).join('/'));
   if (!vault.getAbstractFileByPath(path)) await vault.createFolder(path);
  }
  await vault.createFolder(plan.folder); ownedFolder = true;
  for (const note of plan.notes) {
   if (vault.getAbstractFileByPath(note.path)) throw new Error(`The output path exists: ${note.path}.`);
   await vault.create(note.path, note.content); written.push(note.path);
  }
 } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
 let reportWritten = false;
 try {
  if (ownedFolder && !vault.getAbstractFileByPath(plan.reportPath)) {
   await vault.create(plan.reportPath, importReport(plan, written, error)); reportWritten = true;
  }
 } catch (cause) {
  error = `${error ? `${error} ` : ''}The report could not be written: ${cause instanceof Error ? cause.message : String(cause)}`;
 }
 return { written, complete: !error && reportWritten, error, reportWritten };
}
