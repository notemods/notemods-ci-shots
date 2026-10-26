import { htmlToMarkdown, normalizePath, stringifyYaml, type DataWriteOptions, type Vault } from 'obsidian';
import { parseWxr, type ParsedExport, type RecordData } from './parser';
export const FIELDS = ['title', 'created', 'modified', 'author', 'status', 'categories', 'tags'] as const;
export type Field = typeof FIELDS[number];
export interface Profile { name: string; folder: string; mapping: Partial<Record<Field, string>> }
export interface PlannedFile { path: string; content: string; times?: DataWriteOptions }
export interface Plan { folder: string; files: PlannedFile[]; parsed: ParsedExport; changes: { id: string; state: 'added' | 'changed' | 'removed' }[]; noteCount: number }
export interface Snapshot { version: 1; records: RecordData[] }
export function safeName(value: string): string {
 const name = Array.from(value.normalize('NFC'), (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? '-' : c).join('').replace(/[\\/:*?"<>|#^[\]]/g, '-').trim().replace(/^[. ]+|[. ]+$/g, '');
 let bytes = 0; const stem = Array.from(name).filter((c) => { bytes += new TextEncoder().encode(c).length; return bytes <= 160; }).join('').replace(/[. ]+$/g, '') || 'Post';
 return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem) ? `_${stem}` : stem;
}
export function folderPath(value: string): string {
 const path = normalizePath(value.trim());
 if (!path || path.split('/').some((s) => s.startsWith('.') || safeName(s) !== s)) throw new Error('Use a nonempty folder path with safe names and no dot segments.');
 return path;
}
export function cleanMapping(mapping: Profile['mapping']): Record<Field, string> {
 const result = {} as Record<Field, string>; const used = new Set(['source_id', 'source_type']);
 for (const field of FIELDS) {
  const key = mapping[field] ?? field;
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(key) || used.has(key)) throw new Error('Property names must be distinct letters, numbers, underscores, or dashes.');
  result[field] = key; used.add(key);
 }
 return result;
}
function literal(value: string): string { return value.replace(/([\\`*_[\]<>#])/g, '\\$1').replace(/\r?\n/g, ' '); }
/** Convert in an inert document. Media become links, so opening a note does not load them. */
export function markdown(html: string): string {
 const doc = new DOMParser().parseFromString(html, 'text/html');
 for (const el of Array.from(doc.querySelectorAll('script,style,iframe,object,embed,link,meta,form'))) el.remove();
 for (const el of Array.from(doc.querySelectorAll('img,video,audio,source'))) {
  const url = el.getAttribute('src') ?? el.querySelector('source')?.getAttribute('src') ?? '';
  const label = el.getAttribute('alt') || url || 'Media';
  // Media in a link becomes text, because Markdown links cannot contain links.
  if (el.closest('a')) { el.replaceWith(doc.createTextNode(label)); continue; }
  const link = createEl('a');
  link.textContent = label;
  if (/^https?:\/\/\S+$/i.test(url)) link.setAttribute('href', url);
  el.replaceWith(link);
 }
 for (const el of Array.from(doc.querySelectorAll('*'))) {
  for (const attr of Array.from(el.attributes)) if (attr.name.startsWith('on') || ['src','srcset','style'].includes(attr.name)) el.removeAttribute(attr.name);
  if (el.hasAttribute('href') && !/^(https?:\/\/|mailto:|#)/i.test(el.getAttribute('href') ?? '')) el.removeAttribute('href');
 }
 const codes: string[] = [];
 const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT); let node: Node | null;
 while ((node = walker.nextNode())) node.textContent = (node.textContent ?? '').replace(/\[\/?[A-Za-z][\w-]*(?:\s[^\]\r\n]*)?\]/g, (s) => { const key = `WXRSHORTCODETOKEN${codes.length}END`; codes.push(s); return key; });
 let result = htmlToMarkdown(doc.body).trim();
 result = result.replace(/WXRSHORTCODETOKEN(\d+)END/g, (_, n: string) => codes[Number(n)] ?? '');
 return result;
}
export function noteText(record: RecordData, mapping: Profile['mapping'] = {}): string {
 const keys = cleanMapping(mapping); const properties: Record<string, unknown> = { source_id: record.id, source_type: record.type };
 for (const field of FIELDS) properties[keys[field]] = record[field];
 const lines = ['---', stringifyYaml(properties).trimEnd(), '---', '', `# ${literal(record.title || 'Post')}`, '', markdown(record.html)];
 if (record.comments.length) {
  lines.push('', '## Approved comments');
  for (const c of record.comments) lines.push('', `### ${literal(c.author || 'Anonymous')}`, '', literal(c.date), '', markdown(c.html));
 }
 return lines.join('\n').trimEnd() + '\n';
}
function timestamp(date: string): number | undefined {
 if (!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(date) || date.startsWith('0000')) return undefined;
 const n = Date.parse(date.replace(' ', 'T') + 'Z'); return Number.isFinite(n) ? n : undefined;
}
export function readSnapshot(value: string): Snapshot {
 const data = JSON.parse(value) as Snapshot;
 if (data?.version !== 1 || !Array.isArray(data.records) || data.records.length > 10000) throw new Error('The baseline snapshot is not supported.');
 const ids = new Set<string>();
 for (const r of data.records) {
  if (!r || !/^\d+$/.test(r.id) || ids.has(r.id) || !['post','page'].includes(r.type) || !['title','created','modified','author','status','html'].every((k) => typeof (r as unknown as Record<string, unknown>)[k] === 'string') || !Array.isArray(r.tags) || !Array.isArray(r.categories) || !Array.isArray(r.comments)) throw new Error('The baseline snapshot has an invalid record.');
  ids.add(r.id);
 }
 return data;
}
export function planImport(xml: string, folder: string, mapping: Profile['mapping'] = {}, baseline?: Snapshot): Plan {
 const parsed = parseWxr(xml); const path = folderPath(folder); cleanMapping(mapping);
 const changes: Plan['changes'] = [];
 const old = new Map(baseline?.records.map((r) => [r.id, r]) ?? []);
 const selected = parsed.records.filter((r) => {
  if (!baseline) return true;
  const prior = old.get(r.id); old.delete(r.id);
  if (!prior) { changes.push({ id: r.id, state: 'added' }); return true; }
  if (JSON.stringify(prior) !== JSON.stringify(r)) { changes.push({ id: r.id, state: 'changed' }); return true; }
  return false;
 });
 for (const id of old.keys()) changes.push({ id, state: 'removed' });
 const files: PlannedFile[] = selected.map((r) => ({ path: normalizePath(`${path}/${safeName(r.title)}-${r.id}.md`), content: noteText(r, mapping), times: { ctime: timestamp(r.created), mtime: timestamp(r.modified) } }));
 const index = ['# WordPress import index', '', `${parsed.posts} posts and ${parsed.pages} pages in the source.`, `${selected.length} notes in this folder.`, '', ...files.map((f) => `- [[${f.path.slice(0, -3)}]]`)];
 const report = ['# WordPress import report', '', `Created notes: ${selected.length}`, `Omitted comments: ${parsed.omittedComments}`, `Shortcodes kept as text: ${parsed.shortcodes}`, '', '## Skipped record types', '', ...parsed.skipped.map((s) => `- ${literal(s.type)}: ${s.count}`)];
 if (!parsed.skipped.length) report.push('No skipped records.');
 if (baseline) report.push('', '## Source ID changes', '', ...changes.map((c) => `- ${c.id}: ${c.state}`));
 report.push('', 'Media bytes are outside this import. Media URLs remain links.', 'Check complex HTML and WordPress blocks against the source export.');
 files.push({ path: `${path}/_index.md`, content: index.join('\n') + '\n' }, { path: `${path}/_report.md`, content: report.join('\n') + '\n' }, { path: `${path}/_source.json`, content: JSON.stringify({ version: 1, records: parsed.records }) + '\n' });
 return { folder: path, files, parsed, changes, noteCount: selected.length };
}
export async function writePlan(vault: Pick<Vault, 'getAbstractFileByPath' | 'createFolder' | 'create'>, plan: Plan): Promise<void> {
 if (vault.getAbstractFileByPath(plan.folder)) throw new Error('The destination folder exists. Choose a new folder.');
 for (const f of plan.files) if (vault.getAbstractFileByPath(f.path)) throw new Error('A destination file exists. Choose a new folder.');
 const segments = plan.folder.split('/');
 for (let i = 1; i < segments.length; i++) {
  const path = segments.slice(0, i).join('/');
  if (!vault.getAbstractFileByPath(path)) await vault.createFolder(path);
 }
 // Create the destination once. A folder that appears during parent creation must stop the write.
 await vault.createFolder(plan.folder);
 for (const f of plan.files) await vault.create(f.path, f.content, f.times);
}
