/** Single-line commands in plain Markdown. Source offsets use UTF-16, as CodeMirror does. */
export interface CommandRange { from: number; to: number; source: string }
export interface Result extends CommandRange { text?: string; error?: string }
export interface Snapshot { path: string; source: string; results: Result[] }
export interface PlanInput {
 path: string; source: string; enabled: boolean; live: boolean;
 selections?: readonly { from: number; to: number }[]; snapshot?: Snapshot;
}
export interface Planned extends CommandRange { display: 'source' | 'result' | 'error'; text: string }

export function commands(source: string): CommandRange[] {
 const found: CommandRange[] = [];
 let offset = 0, fence = '', fenceIndent = 0, ticks = '', comment = false, note = false, htmlCode = '';
 let frontmatter = /^(?:\uFEFF)?---\r?\n/.test(source);
 for (const [index, line] of source.split('\n').entries()) {
  const start = offset; offset += line.length + 1;
  if (frontmatter) {
   if (index > 0 && /^(---|\.\.\.)\s*$/.test(line)) frontmatter = false;
   continue;
  }
  const boundary = /^(\s*)(?:(?:[-+*]|\d+[.)])\s+)?(`{3,}|~{3,})/.exec(line);
  if (fence) {
   // A closing fence has less than four columns of extra indentation. Deeper lines are code text.
   if (boundary && boundary[2]![0] === fence[0] && boundary[2]!.length >= fence.length && boundary[1]!.length < fenceIndent + 4 && line.slice(boundary[0].length).trim() === '') fence = '';
   continue;
  }
  // Block structure comes before inline code, so an open backtick run does not hide a fence.
  if (boundary && !htmlCode && !comment && !note) { fence = boundary[2]!; fenceIndent = boundary[1]!.length; ticks = ''; continue; }
  // Inline code does not continue past a paragraph.
  if (line.trim() === '') { ticks = ''; continue; }
  // These contexts are outside the supported plain-paragraph syntax.
  if (/^(?: {4}|\t|\s*>)/.test(line)) continue;
  for (let i = 0; i < line.length;) {
   if (htmlCode) { const end = line.toLowerCase().indexOf(`</${htmlCode}>`, i); if (end < 0) break; i = end + htmlCode.length + 3; htmlCode = ''; continue; }
   if (comment) { const end = line.indexOf('-->', i); if (end < 0) break; comment = false; i = end + 3; continue; }
   if (note) { const end = line.indexOf('%%', i); if (end < 0) break; note = false; i = end + 2; continue; }
   const tag = !ticks ? /^<(pre|code|script|style)(?:\s[^>]*|)>/i.exec(line.slice(i)) : null;
   if (tag) { htmlCode = tag[1]!.toLowerCase(); i += tag[0].length; continue; }
   if (!ticks && line.startsWith('<!--', i)) { comment = true; i += 4; continue; }
   // Obsidian comments use %% and can continue across lines.
   if (!ticks && line.startsWith('%%', i)) { note = true; i += 2; continue; }
   if (line[i] === '\\' && !ticks) { i += 2; continue; }
   if (line[i] === '`') {
    let end = i + 1; while (line[end] === '`') end++;
    const run = line.slice(i, end);
    if (!ticks) ticks = run; else if (ticks === run) ticks = '';
    i = end; continue;
   }
   if (!ticks && line.startsWith('<%+', i)) {
    const end = line.indexOf('%>', i + 3);
    if (end < 0) break;
    found.push({ from: start + i, to: start + end + 2, source: line.slice(i, end + 2) });
    i = end + 2; continue;
   }
   i++;
  }
 }
 return found;
}

export function planNote(input: PlanInput): Planned[] {
 if (!input.enabled || !input.live) return [];
 const snapshot = input.snapshot?.path === input.path && input.snapshot.source === input.source ? input.snapshot : undefined;
 return commands(input.source).map((command) => {
  const result = snapshot?.results.find((r) => r.from === command.from && r.to === command.to && r.source === command.source);
  const editing = input.selections?.some((s) => s.from <= command.to && s.to >= command.from);
  const display = result?.error ? 'error' : !editing && result?.text !== undefined ? 'result' : 'source';
  return { ...command, display, text: display === 'result' ? result!.text! : display === 'error' ? result!.error! : command.source };
 });
}

/** Numeric entities preserve JavaScript punctuation through Markdown parsing. No evaluator is registered. */
export function rendererInput(source: string): string {
 return Array.from(source, (c) => `&#${c.codePointAt(0)!};`).join('');
}

export interface EnableRules { enabled: string[]; disabled: string[]; folders: string; property: string }
export function enabledFor(path: string, metadata: Record<string, unknown>, rules: EnableRules, pro: boolean): boolean {
 if (rules.disabled.includes(path)) return false;
 if (rules.enabled.includes(path)) return true;
 if (!pro) return false;
 const folders = rules.folders.split('\n').map((s) => s.trim().replace(/^\/+|\/+$/g, '')).filter(Boolean);
 return folders.some((folder) => path.startsWith(folder + '/')) || (rules.property.trim() !== '' && metadata[rules.property.trim()] === true);
}

/** One queue for the plugin. A failed or obsolete job does not stop later jobs. */
export class RenderQueue {
 private tail: Promise<void> = Promise.resolve();
 run<T>(valid: () => boolean, job: () => Promise<T>): Promise<T | undefined> {
  const next = this.tail.then(async () => valid() ? job() : undefined);
  this.tail = next.then(() => undefined, () => undefined);
  return next;
 }
}
