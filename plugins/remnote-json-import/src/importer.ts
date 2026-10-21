import { normalizePath, stringifyYaml } from 'obsidian';

export interface Layout { folder: string; prefix: string; groupRoots: string[] }
export interface Warning { id: string; type: string; detail: string }
export interface Rem { id: string; key: unknown; value: unknown; parent: string | null; children: string[]; references: string[]; raw: Record<string, unknown> }
export interface OutputNote { path: string; content: string; ids: string[] }
export interface ImportPlan { notes: OutputNote[]; warnings: Warning[]; snapshot: Record<string, string>; count: number; reportPath: string; folder: string }
export interface Changes { added: string[]; changed: string[]; removed: string[]; unchanged: string[] }
export const DEFAULT_LAYOUT: Layout = { folder: 'RemNote import', prefix: '', groupRoots: [] };
export const MAX_BYTES = 20 * 1024 * 1024;
const MAX_REMS = 25000;

function hasControl(value: string): boolean { return [...value].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127); }
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
export function escapeText(text: string): string { return text.replace(/\\/g, '\\\\').replace(/([`*_{}[\]<>#!|^~$%&])/g, '\\$1'); }
export function safeName(value: string): string {
 let name = [...value.normalize('NFC')].map(c => hasControl(c) ? ' ' : c).join('').replace(/[<>:"/\\|?*#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
 name = [...name].slice(0, 70).join('').trim();
 while (new TextEncoder().encode(name).byteLength > 160) name = [...name].slice(0, -1).join('');
 if (!name || /^\.+$/.test(name)) name = 'Untitled';
 if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) name = `_${name}`;
 return name;
}
export function stableTag(id: string): string {
 let a = 2166136261; let b = 5381;
 for (let i = 0; i < id.length; i++) { a = Math.imul(a ^ id.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ id.charCodeAt(i); }
 return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}
export function validateFolder(value: string): string {
 const s = value.trim().normalize('NFC');
 if (!s || hasControl(s) || s.startsWith('/') || /[\\<>:"|?*#^[\]]/.test(s) || s.split('/').some(p => !p || p.startsWith('.') || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p))) throw new Error('Use a new vault folder without dot segments or reserved characters.');
 return normalizePath(s);
}
export function validateLayout(value: Layout): Layout {
 const folder = validateFolder(value.folder);
 if (typeof value.prefix !== 'string' || value.prefix.length > 40 || hasControl(value.prefix) || /[<>:"/\\|?*#^[\]]/.test(value.prefix)) throw new Error('Use a filename prefix of 40 characters or less without reserved characters.');
 if (!Array.isArray(value.groupRoots) || value.groupRoots.some(id => typeof id !== 'string')) throw new Error('Use source IDs for subtree roots.');
 return { folder, prefix: value.prefix, groupRoots: [...new Set(value.groupRoots.map(s => s.trim()).filter(Boolean))] };
}
function canonical(value: unknown): string {
 if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
 if (object(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
 return JSON.stringify(value) ?? 'null';
}
function short(value: unknown): string { return canonical(value).slice(0, 500); }

export function parseExport(text: string): { rems: Rem[]; warnings: Warning[] } {
 if (new TextEncoder().encode(text).byteLength > MAX_BYTES) throw new Error('The file is larger than 20 MiB. Export a smaller selection.');
 let data: unknown;
 try { data = JSON.parse(text.replace(/^\uFEFF/, '')) as unknown; } catch { throw new Error('The file is not valid JSON.'); }
 // Reject extreme source nesting before canonical snapshots use recursion.
 const nesting = [{ value: data, depth: 0 }];
 while (nesting.length) {
  const entry = nesting.pop()!;
  if (entry.depth > 100) throw new Error('The JSON nesting exceeds 100 levels. Export a simpler selection.');
  const values = Array.isArray(entry.value) ? entry.value as unknown[] : object(entry.value) ? Object.values(entry.value) : [];
  for (const value of values) if (value && typeof value === 'object') nesting.push({ value, depth: entry.depth + 1 });
 }
 if (!object(data) || !Array.isArray(data.docs)) throw new Error('Expected a rem.json object with a docs array.');
 if (data.docs.length > MAX_REMS) throw new Error('The export has more than 25000 Rems. Export a smaller selection.');
 const ids = new Set<string>(); const warnings: Warning[] = [];
 const rems = data.docs.map((item: unknown, index: number): Rem => {
  if (!object(item) || typeof item._id !== 'string' || !item._id.trim() || item._id.length > 200 || hasControl(item._id)) throw new Error(`Record ${index + 1} needs a nonempty source _id of 200 characters or less.`);
  const id = item._id;
  if (ids.has(id)) throw new Error(`Duplicate source ID ${id}.`);
  ids.add(id);
  if (item.parent != null && typeof item.parent !== 'string') throw new Error(`Invalid parent on ${id}.`);
  const list = (key: string): string[] => {
   const value = item[key];
   if (value === undefined || value === null) return [];
   if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) throw new Error(`Invalid ${key} on ${id}.`);
   return [...new Set(value as string[])];
  };
  for (const field of ['key', 'value']) if (item[field] != null && typeof item[field] !== 'string' && !Array.isArray(item[field])) throw new Error(`Invalid ${field} on ${id}. Use text or an array.`);
  for (const field of ['subBlocks', 'portalsIn', 'searchResults']) if (item[field] != null && canonical(item[field]) !== '[]') warnings.push({ id, type: field, detail: short(item[field]) });
  if (item.type !== undefined && item.type !== 1 && item.type !== 2) warnings.push({ id, type: `record-type-${short(item.type)}`, detail: 'Only the key, value and supported relations are converted.' });
  return { id, key: item.key ?? [], value: item.value ?? [], parent: typeof item.parent === 'string' && item.parent ? item.parent : null, children: list('children'), references: list('references'), raw: item };
 });
 const byId = new Map(rems.map(r => [r.id, r]));
 const childSets = new Map(rems.map(r => [r.id, new Set(r.children)]));
 for (const r of rems) for (const childId of r.children) {
  const child = byId.get(childId);
  if (!child) { warnings.push({ id: r.id, type: 'missing-child', detail: childId }); continue; }
  if (!child.parent) child.parent = r.id;
  else if (child.parent !== r.id) warnings.push({ id: r.id, type: 'parent-conflict', detail: `${childId} has parent ${child.parent}.` });
 }
 for (const r of rems) {
  if (r.parent && !byId.has(r.parent)) warnings.push({ id: r.id, type: 'missing-parent', detail: r.parent });
  if (r.parent && byId.has(r.parent)) {
   const parent = byId.get(r.parent)!;
   const children = childSets.get(parent.id)!;
   if (!children.has(r.id)) { parent.children.push(r.id); children.add(r.id); }
  }
 }
 // Follow each parent chain once. Reject cycles before a subtree can be grouped.
 const done = new Set<string>();
 for (const r of rems) {
  const chain = new Set<string>(); let cursor: Rem | undefined = r;
  while (cursor && !done.has(cursor.id)) {
   if (chain.has(cursor.id)) throw new Error(`Parent cycle at ${cursor.id}. Repair the export before import.`);
   chain.add(cursor.id); cursor = cursor.parent ? byId.get(cursor.parent) : undefined;
  }
  for (const id of chain) done.add(id);
 }
 return { rems, warnings };
}
function plain(value: unknown, depth = 0): string {
 if (depth > 20) return '[Unsupported depth]';
 if (typeof value === 'string') return value;
 if (Array.isArray(value)) return value.map(v => plain(v, depth + 1)).join('');
 if (object(value) && typeof value.text === 'string') return value.text;
 if (object(value) && value.i === 'q' && typeof value._id === 'string') return `Rem ${value._id}`;
 return '';
}
export function planImport(text: string, options: Layout = DEFAULT_LAYOUT): ImportPlan {
 const layout = validateLayout(options); const { rems, warnings } = parseExport(text);
 const byId = new Map(rems.map(r => [r.id, r]));
 const titles = new Map(rems.map(r => [r.id, safeName(plain(r.key))]));
 const owners = new Map(rems.map(r => [r.id, r.id]));
 for (const root of layout.groupRoots) {
  if (!byId.has(root)) throw new Error(`Subtree root ${root} is not in this export.`);
  const todo = [root];
  while (todo.length) {
   const id = todo.pop()!;
   if (owners.get(id) !== id || (id !== root && layout.groupRoots.includes(id))) throw new Error('Selected subtrees overlap. Select separate roots.');
   owners.set(id, root);
   for (const child of byId.get(id)!.children) if (byId.get(child)?.parent === id) todo.push(child);
  }
 }
 const paths = new Map<string, string>(); const usedPaths = new Set<string>(); const tags = new Set<string>();
 for (const r of rems) {
  const tag = stableTag(r.id);
  if (tags.has(tag)) throw new Error('Two source IDs have the same filename tag. Import separate selections.');
  tags.add(tag);
  if (owners.get(r.id) !== r.id) continue;
  const path = normalizePath(`${layout.folder}/${safeName(layout.prefix + titles.get(r.id)!)}--${tag}.md`);
  if (usedPaths.has(path.toLocaleLowerCase())) throw new Error('Two notes have the same output path.');
  usedPaths.add(path.toLocaleLowerCase()); paths.set(r.id, path);
 }
 const link = (id: string, from: string): string => {
  const target = byId.get(id);
  if (!target) { warnings.push({ id: from, type: 'missing-reference', detail: id }); return `[Missing Rem: ${escapeText(id)}]`; }
  const owner = owners.get(id)!; const path = paths.get(owner)!.replace(/\.md$/, '');
  return `[[${path}${owner === id && !layout.groupRoots.includes(owner) ? '' : `#Rem ${stableTag(id)}`}|${titles.get(id)!}]]`;
 };
 const render = (value: unknown, id: string, depth = 0): string => {
  if (depth > 20) { warnings.push({ id, type: 'rich-text-depth', detail: 'Nested rich text exceeds 20 levels.' }); return '[Unsupported depth]'; }
  if (typeof value === 'string') {
   if (value.includes('%LOCAL_FILE%')) { warnings.push({ id, type: 'media', detail: value.slice(0, 500) }); return '[Unsupported local file]'; }
   return escapeText(value);
  }
  if (Array.isArray(value)) return value.map(v => render(v, id, depth + 1)).join('');
  if (object(value)) {
   if (value.i === 'q' && typeof value._id === 'string') return link(value._id, id);
   if ((value.i === 'm' || value.i === 'text' || value.i === undefined) && typeof value.text === 'string') {
    const whitespace = /^(\s*)([\s\S]*?)(\s*)$/.exec(value.text)!;
    let result = escapeText(whitespace[2]!);
    if (result && (value.b === true || value.bold === true)) result = `**${result}**`;
    if (result && (value.it === true || value.italic === true)) result = `*${result}*`;
    result = whitespace[1]! + result + whitespace[3]!;
    const extras = Object.keys(value).filter(k => !['i', 'text', 'b', 'bold', 'it', 'italic'].includes(k));
    if (extras.length) warnings.push({ id, type: 'format-options', detail: extras.join(', ') });
    return result;
   }
   if (object(value.content) && ('imageUrl' in value.content || 'imageBlob' in value.content)) { warnings.push({ id, type: 'media', detail: short(value) }); return '[Unsupported image]'; }
  }
  warnings.push({ id, type: object(value) ? `object-${short(value.i ?? 'unknown').replace(/"/g, '')}` : `fragment-${typeof value}`, detail: short(value) });
  return '[Unsupported content]';
 };
 const sections = new Map<string, string>();
 for (const r of rems) {
  let body = `${render(r.key, r.id)}\n`;
  const value = render(r.value, r.id);
  if (value) body += `\n${value}\n`;
  if (r.parent) body += `\nParent: ${link(r.parent, r.id)}\n`;
  const children = r.children.filter(id => byId.get(id)?.parent === r.id);
  if (children.length) body += `\nChildren:\n${children.map(id => `- ${link(id, r.id)}`).join('\n')}\n`;
  if (r.references.length) body += `\nReferences:\n${r.references.map(id => `- ${link(id, r.id)}`).join('\n')}\n`;
  sections.set(r.id, body);
 }
 const notes: OutputNote[] = [];
 for (const r of rems) {
  if (owners.get(r.id) !== r.id) continue;
  const grouped = layout.groupRoots.includes(r.id); const members: Rem[] = [];
  if (grouped) {
   const todo = [r.id];
   while (todo.length) { const id = todo.pop()!; const rem = byId.get(id)!; members.push(rem); const children = rem.children.filter(c => owners.get(c) === r.id && byId.get(c)?.parent === id); for (let i = children.length - 1; i >= 0; i--) todo.push(children[i]!); }
  } else members.push(r);
  const properties = grouped ? { remnote_id: r.id, remnote_ids: members.map(m => m.id) } : { remnote_id: r.id };
  const body = grouped ? members.map(m => `## Rem ${stableTag(m.id)}\n\n${sections.get(m.id)!}`).join('\n') : sections.get(r.id)!;
  notes.push({ path: paths.get(r.id)!, content: `---\n${stringifyYaml(properties).trimEnd()}\n---\n\n# ${escapeText(titles.get(r.id)!)}\n\n${body}`, ids: members.map(m => m.id) });
 }
 const snapshot = Object.fromEntries(rems.map(r => [r.id, canonical(r.raw)]));
 // Repeated warnings are shown once in the report.
 const unique = new Map(warnings.map(w => [canonical(w), w]));
 return { notes, warnings: [...unique.values()], snapshot, count: rems.length, reportPath: normalizePath(`${layout.folder}/Import report.md`), folder: layout.folder };
}
export function compareSnapshots(current: Record<string, string>, previous: Record<string, string>): Changes {
 const changes: Changes = { added: [], changed: [], removed: [], unchanged: [] };
 for (const id of Object.keys(current).sort()) { if (!Object.prototype.hasOwnProperty.call(previous, id)) changes.added.push(id); else if (current[id] !== previous[id]) changes.changed.push(id); else changes.unchanged.push(id); }
 for (const id of Object.keys(previous).sort()) if (!Object.prototype.hasOwnProperty.call(current, id)) changes.removed.push(id);
 return changes;
}
export function importReport(plan: ImportPlan, written: string[], error?: string): string {
 const quote = (v: string) => escapeText(v).replace(/\r?\n/g, ' ');
 return `# RemNote import report\n\nSource Rems: ${plan.count}\n\nPlanned notes: ${plan.notes.length}\n\nWritten notes: ${written.length}\n\nStatus: ${error ? `Stopped. ${quote(error)}` : 'Complete.'}\n\n## Written notes\n\n${written.map(p => `- ${quote(p)}`).join('\n') || 'None.'}\n\n## Missing references and unsupported content\n\n${plan.warnings.map(w => `- ${quote(w.id)} - ${quote(w.type)}: ${quote(w.detail)}`).join('\n') || 'No warnings in the supported fields.'}\n\nMedia is not copied or downloaded. Keep the source export and its attachments.\n`;
}
