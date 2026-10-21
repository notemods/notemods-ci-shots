import { bundledFont } from './truetype';
import { writePdf } from './pdf-writer';
import type { Card } from './cards';
export interface PageSettings { margin: number; textSize: number; answerSpace: number }
export const DEFAULT_PAGE: PageSettings = { margin: 48, textSize: 12, answerSpace: 48 };
export function pageSettings(value: Partial<PageSettings> | null | undefined): PageSettings {
 const clamp = (n: unknown, fallback: number, min: number, max: number) => typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
 return { margin: clamp(value?.margin, 48, 24, 100), textSize: clamp(value?.textSize, 12, 8, 24), answerSpace: clamp(value?.answerSpace, 48, 0, 200) };
}
export interface SheetLine { text: string; y: number }
export interface SheetPage { kind: 'questions' | 'answers'; lines: SheetLine[] }
const WIDTH = 595.28;
const HEIGHT = 841.89;

/** Split long words by Unicode code point. Keep the text inside the page width. */
export function wrapText(text: string, width: number, measure: (text: string) => number): string[] {
 const lines: string[] = [];
 let current = '';
 for (const word of text.trim().split(/\s+/u)) {
  if (!word) continue;
  if (measure(current ? current + ' ' + word : word) <= width) { current = current ? current + ' ' + word : word; continue; }
  if (current) { lines.push(current); current = ''; }
  for (const char of word) {
   if (measure(char) > width) throw new Error('A character is wider than the page.');
   if (current && measure(current + char) > width) { lines.push(current); current = ''; }
   current += char;
  }
 }
 if (current) lines.push(current);
 return lines;
}
export function layoutSheet(cards: Card[], settings: PageSettings, measure: (text: string) => number): SheetPage[] {
 const s = pageSettings(settings);
 const pages: SheetPage[] = [];
 const lineHeight = s.textSize * 1.5;
 for (const kind of ['questions', 'answers'] as const) {
  let page: SheetPage;
  let y = 0;
  const next = () => { page = { kind, lines: [] }; pages.push(page); y = HEIGHT - s.margin - s.textSize * 3; };
  next();
  cards.forEach((card, index) => {
   const lines = wrapText(`${index + 1}. ${kind === 'questions' ? card.question : card.answer}`, WIDTH - 2 * s.margin, measure);
   for (const text of lines) {
    if (y < s.margin + s.textSize) next();
    page.lines.push({ text, y }); y -= lineHeight;
   }
   const gap = kind === 'questions' ? s.answerSpace : lineHeight;
   // Blank answer space can cross a page boundary. It contains no text.
   let left = gap;
   while (left > y - s.margin) { left -= Math.max(0, y - s.margin); next(); }
   y -= left;
  });
 }
 return pages.filter((page) => page.lines.length > 0);
}
export function missingGlyphs(text: string): string[] {
 const font = bundledFont();
 return [...new Set([...text].filter((c) => !/\s/u.test(c) && !font.glyphId(c)))];
}
export async function makePdf(cards: Card[], settings = DEFAULT_PAGE): Promise<Uint8Array> {
 if (!cards.length) throw new Error('Select at least one card.');
 const missing = missingGlyphs(cards.map((c) => c.question + ' ' + c.answer).join(' '));
 if (missing.length) throw new Error(`The bundled Noto Sans font has no glyph for ${missing.map((c) => `${c} (U+${c.codePointAt(0)!.toString(16).toUpperCase()})`).join(', ')}. No PDF was saved.`);
 const font = bundledFont(); const s = pageSettings(settings);
 const plan = layoutSheet(cards, s, (text) => font.width(text, s.textSize));
 return await Promise.resolve(writePdf(plan, s, font));
}
