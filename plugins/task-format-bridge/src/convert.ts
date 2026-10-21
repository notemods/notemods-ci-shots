export type Format = 'emoji' | 'dataview';
export interface Change { line: number; before: string; after: string }
export interface Warning { line: number; reason: string }
export interface Conversion { text: string; changes: Change[]; warnings: Warning[] }
const DATES: Record<string, string> = { start: '🛫', scheduled: '⏳', due: '📅', created: '➕', completion: '✅', cancelled: '❌' };
const PRIORITIES: Record<string, string> = { highest: '🔺', high: '⏫', medium: '🔼', low: '🔽', lowest: '⏬' };
const SYMBOLS: Record<string, string> = { ...DATES, repeat: '🔁', onCompletion: '🏁', id: '🆔', dependsOn: '⛔' };
const ALIASES: Record<string, string> = { '📆': 'due', '🗓': 'due', '⌛': 'scheduled' };
const KEYS = Object.keys(SYMBOLS).concat('priority');
const KNOWN = /(?:🛫|⏳|⌛|📅|📆|🗓|➕|✅|❌|🔁|🏁|🆔|⛔|🔺|⏫|🔼|🔽|⏬|[[(]\s*(?:start|scheduled|due|created|completion|cancelled|repeat|onCompletion|id|dependsOn|priority)\s*::)/u;
export const MAX_CHARS = 1_000_000;
export function isDate(value: string): boolean {
 if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
 const d = new Date(value + 'T00:00:00Z');
 return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === value;
}
function valid(key: string, value: string): boolean {
 if (key in DATES) return isDate(value);
 if (key === 'priority') return Object.prototype.hasOwnProperty.call(PRIORITIES, value);
 if (key === 'repeat') return /^every [a-zA-Z0-9,! ]+$/.test(value);
 if (key === 'onCompletion') return value === 'keep' || value === 'delete';
 if (key === 'id') return /^[a-zA-Z0-9]+$/.test(value);
 return key === 'dependsOn' && /^[a-zA-Z0-9]+(?:,[a-zA-Z0-9]+)*$/.test(value);
}
interface Token { key: string; value: string; space: string; raw: string; format: Format }
function lastField(text: string): { rest: string; token: Token } | null {
 const dv = /(^|[\t ]+)(\[([^\]]*)\]|\(([^()]*)\))$/.exec(text);
 if (dv) {
  const pair = /^\s*([a-zA-Z]+)\s*::\s*(.*?)\s*$/.exec(dv[3] ?? dv[4] ?? '');
  if (pair && KEYS.includes(pair[1]!)) return { rest: text.slice(0, dv.index), token: { key: pair[1]!, value: pair[2]!, space: dv[1]!, raw: dv[2]!, format: 'dataview' } };
 }
 const priorityMatch = /(^|[\t ]+)(🔺|⏫|🔼|🔽|⏬)$/u.exec(text);
 if (priorityMatch) {
  const priority = Object.keys(PRIORITIES).find((k) => PRIORITIES[k] === priorityMatch[2])!;
  return { rest: text.slice(0, priorityMatch.index), token: { key: 'priority', value: priority, space: priorityMatch[1]!, raw: priorityMatch[2]!, format: 'emoji' } };
 }
 const emoji = /(^|[\t ]+)(🛫|⏳|⌛|📅|📆|🗓|➕|✅|❌|🏁|🆔|⛔)\uFE0F?[\t ]+([^\t ]+)$/u.exec(text)
  ?? /(^|[\t ]+)(🔁)[\t ]+([a-zA-Z0-9,! ]+)$/u.exec(text);
 if (!emoji) return null;
 const key = ALIASES[emoji[2]!] ?? Object.keys(SYMBOLS).find((k) => SYMBOLS[k] === emoji[2])!;
 return { rest: text.slice(0, emoji.index), token: { key, value: emoji[3]!, space: emoji[1]!, raw: text.slice(emoji.index + emoji[1]!.length), format: 'emoji' } };
}
function render(token: Token, target: Format): string {
 if (token.format === target) return token.raw;
 if (target === 'dataview') return `[${token.key}:: ${token.value}]`;
 if (token.key === 'priority') return PRIORITIES[token.value]!;
 return `${SYMBOLS[token.key]} ${token.value}`;
}
type Comment = '' | 'html' | 'percent';
function comments(text: string, state: Comment): { state: Comment; touched: boolean } {
 // Only matched, equal-length backtick runs delimit inline code.
 const runs = [...text.matchAll(/`+/g)], next = new Map<number, number>(), ends = new Map<number, number>();
 for (let n = runs.length - 1; n >= 0; n--) {
  const run = runs[n]!, end = next.get(run[0].length);
  if (end !== undefined) ends.set(run.index, end + run[0].length);
  next.set(run[0].length, run.index);
 }
 let touched = !!state;
 for (let i = 0; i < text.length;) {
  if (state) {
   const marker = state === 'html' ? '-->' : '%%', end = text.indexOf(marker, i);
   if (end < 0) break;
   i = end + marker.length; state = ''; continue;
  }
  if (text[i] === '\\') { i += 2; continue; }
  const codeEnd = ends.get(i);
  if (codeEnd !== undefined) { i = codeEnd; continue; }
  if (text.startsWith('<!--', i)) { touched = true; state = 'html'; i += 4; }
  else if (text.startsWith('%%', i)) { touched = true; state = 'percent'; i += 2; }
  else i++;
 }
 return { state, touched };
}
function indentation(text: string): number {
 let width = 0;
 for (const ch of text) width += ch === '\t' ? 4 - width % 4 : 1;
 return width;
}
export function convert(markdown: string, target: Format): Conversion {
 if (target !== 'emoji' && target !== 'dataview') throw new Error('Unknown task format');
 if (markdown.length > MAX_CHARS) return { text: markdown, changes: [], warnings: [{ line: 1, reason: 'Note exceeds the 1,000,000 character limit.' }] };
 const parts = markdown.split(/(\r\n|\n|\r)/), changes: Change[] = [], warnings: Warning[] = [];
 let yaml = false, fence = '', fenceSize = 0, comment: Comment = '', quoteDepth = 0;
 const parents: number[] = [];
 for (let n = 0; n < parts.length; n += 2) {
  const before = parts[n]!, line = n / 2 + 1;
  if (n === 0 && /^\uFEFF?---\s*$/.test(before)) { yaml = true; continue; }
  if (yaml) { if (/^(---|\.\.\.)\s*$/.test(before)) yaml = false; continue; }
  // Quoted fences use the same blockquote-prefix removal as quoted task lines.
  let plain = before, depth = 0;
  while (/^ {0,3}>[\t ]?/.test(plain)) { plain = plain.replace(/^ {0,3}>[\t ]?/, ''); depth++; }
  if (depth !== quoteDepth) { parents.length = 0; quoteDepth = depth; }
  const fenceText = fence ? plain : plain.replace(/^[\t ]*(?:[-+*]|\d+[.)])[\t ]+/, '');
  const f = /^\s*(`{3,}|~{3,})(.*)$/.exec(fenceText);
  if (f && !comment) {
   if (!fence) { fence = f[1]![0]!; fenceSize = f[1]!.length; }
   else if (f[1]![0] === fence && f[1]!.length >= fenceSize && !f[2]!.trim()) fence = '';
   continue;
  }
  if (fence) continue;
  const wasComment = !!comment, parsed = comments(plain, comment); comment = parsed.state;
  if (parsed.touched) {
   if (!wasComment && /^(?:[\t ]*>[\t ]*)*[\t ]*(?:[-+*]|\d+[.)])[\t ]+\[[^\]\r\n]\][\t ]+/.test(before) && KNOWN.test(before)) warnings.push({ line, reason: 'Comment on task line. Line kept.' });
   continue;
  }
  const list = /^([\t ]*)(?:[-+*]|\d+[.)])[\t ]+/.exec(plain);
  const indent = indentation(/^[\t ]*/.exec(plain)![0]);
  while (parents.length && parents[parents.length - 1]! >= indent && (list || plain.trim())) parents.pop();
  const nested = parents.length > 0;
  if (list && (indent < 4 || nested)) parents.push(indent);
  const task = /^((?:[\t ]*>[\t ]*)*[\t ]*(?:[-+*]|\d+[.)])[\t ]+\[[^\]\r\n]\][\t ]+)(.*)$/.exec(before);
  if (!task) continue;
  if (indent >= 4 && !nested) { if (KNOWN.test(task[2]!)) warnings.push({ line, reason: 'Deep indentation can be code. Line kept.' }); continue; }
  let body = task[2]!, tail = '';
  const block = /([\t ]+\^[a-zA-Z0-9-]+[\t ]*)$/.exec(body);
  if (block) { tail = block[1]!; body = body.slice(0, block.index); }
  else { const white = /[\t ]+$/.exec(body); if (white) { tail = white[0]; body = body.slice(0, -tail.length); } }
  for (;;) {
   const tag = /([\t ]+)(#[\p{L}\p{N}_/-]+)$/u.exec(body);
   if (!tag || !/[\p{L}_/-]/u.test(tag[2]!)) break;
   tail = tag[0] + tail; body = body.slice(0, tag.index);
  }
  const tokens: Token[] = [];
  for (;;) { const field = lastField(body); if (!field) break; tokens.unshift(field.token); body = field.rest; }
  if (!tokens.length) {
   if (KNOWN.test(body)) warnings.push({ line, reason: 'Field is not a supported trailing field. Line kept.' });
   continue;
  }
  const seen = new Set<string>(); let problem = '';
  for (const token of tokens) {
   if (seen.has(token.key)) problem = `Duplicate ${token.key} field. Line kept.`;
   if (!valid(token.key, token.value)) problem = `Invalid or unsupported ${token.key} value. Line kept.`;
   seen.add(token.key);
  }
  if (KNOWN.test(body)) problem = 'Field occurs inside the description, code, or unsupported syntax. Line kept.';
  if (problem) { warnings.push({ line, reason: problem }); continue; }
  const after = task[1]! + body + tokens.map((t) => t.space + render(t, target)).join('') + tail;
  if (after !== before) { parts[n] = after; changes.push({ line, before, after }); }
 }
 return { text: parts.join(''), changes, warnings };
}
