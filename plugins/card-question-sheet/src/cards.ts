export interface Card { question: string; answer: string; line: number; source: string }
export interface Unsupported { line: number; source: string; text: string; reason: string }
export interface Parsed { cards: Card[]; unsupported: Unsupported[] }

/** Read one plain text card per line. Keep the source text for error reports. */
export function parseCards(text: string, source = ''): Parsed {
 const result: Parsed = { cards: [], unsupported: [] };
 const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
 // A first line of --- without a closing line is a rule, not frontmatter.
 let frontmatter = lines[0]?.trim() === '---' && lines.slice(1).some((l) => /^(---|\.\.\.)$/.test(l.trim()));
 let fence: { char: string; length: number } | null = null;
 for (let i = 0; i < lines.length; i++) {
  const raw = lines[i]!;
  const value = raw.trim();
  if (frontmatter) { if (i > 0 && /^(---|\.\.\.)$/.test(value)) frontmatter = false; continue; }
  const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(raw);
  if (fence) { if (marker && marker[1]![0] === fence.char && marker[1]!.length >= fence.length && !marker[2]!.trim()) fence = null; continue; }
  if (marker) { fence = { char: marker[1]![0]!, length: marker[1]!.length }; continue; }
  if (!value.includes('::') && !/^\?{1,2}$/.test(value)) continue;
  let reason = '';
  if (/!\[|<img\b/i.test(value)) reason = 'Image or embed';
  else if (/\{\{/.test(value)) reason = 'Cloze marker';
  else if (/\$|\\\(|\\\[/.test(value)) reason = 'Math';
  else if (/^\?{1,2}$/.test(value)) reason = 'Multiline card marker';
  else if (/[\u0590-\u08ff\u200f\u202b\u202e\u2067\ufb1d-\ufdff\ufe70-\ufefc]/u.test(value)) reason = 'Right-to-left text';
  else if ([...value].some((c) => { const n = c.codePointAt(0)!; return (n < 32 && n !== 9) || n === 127; })) reason = 'Control character';
  const separators = [...value.matchAll(/:{2,}/g)];
  if (!reason && (separators.length !== 1 || separators[0]![0].length > 3)) reason = 'Multiple or invalid separators';
  const sep = separators[0];
  const question = sep ? value.slice(0, sep.index).trim() : '';
  const answer = sep ? value.slice(sep.index + sep[0].length).trim() : '';
  if (!reason && (!question || !answer)) reason = 'Empty question or answer';
  if (reason) { result.unsupported.push({ line: i + 1, source, text: raw, reason }); continue; }
  result.cards.push({ question, answer, line: i + 1, source });
  if (sep![0].length === 3) result.cards.push({ question: answer, answer: question, line: i + 1, source });
 }
 return result;
}

/** Use a new name. The vault create operation also refuses an existing file. */
export function outputPath(source: string, exists: (path: string) => boolean): string {
 const base = source.replace(/\.md$/i, '') + ' questions';
 for (let n = 0; n < 10000; n++) {
  const path = `${base}${n ? ' ' + n : ''}.pdf`;
  if (!exists(path)) return path;
 }
 throw new Error('No free output name.');
}
export function inFolder(path: string, folder: string): boolean { return !folder || path.startsWith(folder + '/'); }
