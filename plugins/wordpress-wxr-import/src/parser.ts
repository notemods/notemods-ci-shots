export const MAX_BYTES = 20 * 1024 * 1024;
const CONTENT = 'http://purl.org/rss/1.0/modules/content/';
const DC = 'http://purl.org/dc/elements/1.1/';
export interface Comment { author: string; date: string; html: string }
export interface RecordData {
 id: string; type: string; title: string; created: string; modified: string;
 author: string; status: string; categories: string[]; tags: string[]; html: string; comments: Comment[];
}
export interface ParsedExport { records: RecordData[]; posts: number; pages: number; skipped: { type: string; count: number }[]; omittedComments: number; shortcodes: number }

/** Check the size and syntax before the browser parses the document. */
function checkXml(xml: string): void {
 if (new TextEncoder().encode(xml).length > MAX_BYTES) throw new Error('The file exceeds the 20 MiB limit.');
 if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(xml)) throw new Error('DOCTYPE and entity declarations are not supported.');
 const stack: string[] = []; let roots = 0;
 const token = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?[A-Za-z_][\w:.-]*(?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*\s*\/?>|[^<]+/gy;
 let offset = 0; let part: RegExpExecArray | null;
 while ((part = token.exec(xml))) {
  offset = token.lastIndex; const s = part[0];
  if (s.startsWith('<!--') || s.startsWith('<?')) continue;
  if (s.startsWith('<![CDATA[')) { if (!stack.length) throw new Error('Malformed XML: CDATA outside the root.'); continue; }
  if (!s.startsWith('<')) {
   if ((!stack.length && s.trim().replace(/^\uFEFF/, '')) || /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/.test(s)) throw new Error('Malformed XML: text or entity.');
   continue;
  }
  const name = /^<\/?([\w:.-]+)/.exec(s)?.[1] ?? '';
  if (s.startsWith('</')) { if (!/^<\/[\w:.-]+\s*>$/.test(s)) throw new Error('Malformed XML: closing tag.'); if (stack.pop() !== name) throw new Error('Malformed XML: tags do not match.'); }
  else {
   if (!stack.length) roots++;
   const attrs = [...s.matchAll(/\s([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)];
   if (new Set(attrs.map((a) => a[1])).size !== attrs.length) throw new Error('Malformed XML: duplicate attributes.');
   for (const a of attrs) if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/.test(a[2] ?? a[3] ?? '')) throw new Error('Malformed XML: attribute entity.');
   if (!s.endsWith('/>')) stack.push(name);
   if (stack.length > 100) throw new Error('The XML nesting exceeds 100 levels.');
  }
 }
 if (offset !== xml.length || stack.length || roots !== 1) throw new Error('Malformed XML: incomplete document.');
}
function child(el: Element, name: string, ns: string | null = null): Element[] {
 return Array.from(el.children).filter((x) => x.localName === name && (ns === null ? !x.namespaceURI : x.namespaceURI === ns));
}
function text(el: Element, name: string, ns: string | null = null): string { return child(el, name, ns)[0]?.textContent ?? ''; }
/** Drafts have a zero GMT date. Then use the local date of the same record. */
function date(el: Element, name: string, ns: string): string {
 const gmt = text(el, `${name}_gmt`, ns); const local = text(el, name, ns);
 return gmt && !/^0000-00-00/.test(gmt.trim()) ? gmt : local || gmt;
}
export function parseWxr(xml: string): ParsedExport {
 checkXml(xml);
 const doc = new DOMParser().parseFromString(xml, 'application/xml');
 if (doc.getElementsByTagName('parsererror').length || doc.documentElement?.localName !== 'rss') throw new Error('Malformed XML or missing RSS root.');
 const channel = child(doc.documentElement, 'channel');
 if (channel.length !== 1) throw new Error('The export must have one RSS channel.');
 const wp = Array.from(channel[0]!.children).find((x) => x.localName === 'wxr_version' && /^http:\/\/wordpress.org\/export\/1\.[012]\/$/.test(x.namespaceURI ?? ''))?.namespaceURI;
 if (!wp) throw new Error('The export has no supported WXR namespace or version field.');
 const out: ParsedExport = { records: [], posts: 0, pages: 0, skipped: [], omittedComments: 0, shortcodes: 0 };
 const skipped = new Map<string, number>(); const ids = new Set<string>();
 const items = child(channel[0]!, 'item');
 if (items.length > 10000) throw new Error('The export exceeds the 10000 record limit.');
 for (const item of items) {
  const type = text(item, 'post_type', wp) || 'unknown';
  if (type !== 'post' && type !== 'page') { skipped.set(type, (skipped.get(type) ?? 0) + 1); continue; }
  const id = text(item, 'post_id', wp).trim();
  if (!/^\d+$/.test(id) || ids.has(id)) throw new Error('Post and page source IDs must be numeric and unique.');
  ids.add(id);
  const comments: Comment[] = [];
  for (const c of child(item, 'comment', wp)) {
   if (text(c, 'comment_approved', wp).trim() !== '1') { out.omittedComments++; continue; }
   comments.push({ author: text(c, 'comment_author', wp), date: date(c, 'comment_date', wp), html: text(c, 'comment_content', wp) });
  }
  const terms = child(item, 'category');
  const html = text(item, 'encoded', CONTENT);
  out.shortcodes += (html.match(/\[\/?[A-Za-z][\w-]*(?:\s[^\]\r\n]*)?\]/g) ?? []).length;
  out.records.push({ id, type, title: text(item, 'title'), created: date(item, 'post_date', wp), modified: date(item, 'post_modified', wp), author: text(item, 'creator', DC), status: text(item, 'status', wp), categories: terms.filter((x) => x.getAttribute('domain') === 'category').map((x) => x.textContent ?? ''), tags: terms.filter((x) => x.getAttribute('domain') === 'post_tag').map((x) => x.textContent ?? ''), html, comments });
  if (type === 'post') out.posts++; else out.pages++;
 }
 out.skipped = [...skipped].sort(([a], [b]) => a.localeCompare(b)).map(([type, count]) => ({ type, count }));
 return out;
}
