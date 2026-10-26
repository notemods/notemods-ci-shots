import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFDict, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { makePdf, layoutSheet, wrapText, missingGlyphs, pageSettings, DEFAULT_PAGE } from '../src/pdf';
import { parseCards } from '../src/cards';
describe('PDF text and layout', () => {
 it('puts the answer key on a separate page', async () => {
  const bytes = await makePdf(parseCards('Capital of France::Paris\n2+2::4').cards);
  const pdf = await PDFDocument.load(bytes); expect(pdf.getPageCount()).toBe(2);
  expect(pdf.getPages().map((p) => p.getSize())).toEqual([{ width: 595.28, height: 841.89 }, { width: 595.28, height: 841.89 }]);
 });
 it('embeds Unicode text with exact selectable character maps', async () => {
  const pdf = await PDFDocument.load(await makePdf(parseCards('Café — α::Ж').cards));
  const mappings: string[] = [];
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
   if (!(object instanceof PDFDict)) continue;
   const entry = object.get(PDFName.of('ToUnicode'));
   if (entry) { const stream = pdf.context.lookup(entry, PDFRawStream); mappings.push(new TextDecoder().decode(decodePDFRawStream(stream).decode())); }
  }
  const cmap = mappings.join(' ').toUpperCase();
  for (const code of ['00E9', '2014', '03B1', '0416']) expect(cmap).toContain(code);
 });
 it('keeps 2000 answer words and a 400 character word within the page', async () => {
  const cards = parseCards('Long::' + 'word '.repeat(2000) + '\n' + 'x'.repeat(400) + '::end').cards;
  const pages = layoutSheet(cards, DEFAULT_PAGE, (text) => text.length * 7);
  expect(pages.length).toBeGreaterThan(3);
  const answers = pages.filter((p) => p.kind === 'answers').flatMap((p) => p.lines.map((l) => l.text)).join(' ');
  expect(answers.match(/word/g)?.length).toBe(2000); expect(answers).toContain('2. end');
  const questions = pages.filter((p) => p.kind === 'questions').flatMap((p) => p.lines.map((l) => l.text)).join('');
  expect(questions.match(/x/g)?.length).toBe(400);
  for (const page of pages) for (const line of page.lines) { expect(line.text.length * 7).toBeLessThanOrEqual(595.28 - 96); expect(line.y).toBeGreaterThanOrEqual(60); }
  const pdf = await PDFDocument.load(await makePdf(cards)); expect(pdf.getPageCount()).toBeGreaterThan(2);
 });
 it('renumbers only selected cards with matching answers', () => {
  const cards = parseCards('A::1\nB::2\nC::3').cards.filter((_, i) => i !== 1);
  const pages = layoutSheet(cards, DEFAULT_PAGE, (s) => s.length * 7);
  expect(pages[0]!.lines.map((l) => l.text)).toEqual(['1. A', '2. C']);
  expect(pages[1]!.lines.map((l) => l.text)).toEqual(['1. 1', '2. 3']);
 });
 it('blocks missing glyphs and an empty selection', async () => {
  expect(missingGlyphs('Café — α Ж')).toEqual([]); expect(missingGlyphs('汉汉')).toEqual(['汉']);
  await expect(makePdf(parseCards('Han::汉').cards)).rejects.toThrow('U+6C49'); await expect(makePdf([])).rejects.toThrow('Select at least one card');
 });
 it('normalizes page settings and splits by code point', () => {
  expect(pageSettings({ margin: NaN, textSize: Infinity, answerSpace: -1 })).toEqual({ ...DEFAULT_PAGE, answerSpace: 0 });
  expect(wrapText('😀😀😀', 2, (s) => [...s].length)).toEqual(['😀😀', '😀']);
 });
});
