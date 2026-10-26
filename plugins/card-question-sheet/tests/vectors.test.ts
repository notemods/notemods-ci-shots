import { describe, expect, it } from 'vitest';
import vectors from './vectors/card-question-sheet.json';
import { parseCards, outputPath, inFolder } from '../src/cards';
import { DEFAULT_PAGE, layoutSheet, wrapText, missingGlyphs, pageSettings, makePdf } from '../src/pdf';
describe('golden acceptance vectors', () => {
 for (const item of vectors.cases) it(item.name, async () => {
  const args = item.args as unknown[]; let actual: unknown;
  switch (item.function) {
   case 'browserPdf': actual = new TextDecoder().decode((await makePdf(parseCards(args[0] as string).cards)).slice(0, 5)); break;
   case 'parse': actual = parseCards(args[0] as string, args[1] as string | undefined); break;
   case 'wrap': actual = wrapText(args[0] as string, args[1] as number, (s) => s.length); break;
   case 'glyphs': actual = missingGlyphs(args[0] as string); break;
   case 'path': actual = outputPath(args[0] as string, (p) => (args[1] as string[]).includes(p)); break;
   case 'folder': actual = inFolder(args[0] as string, args[1] as string); break;
   case 'settings': actual = pageSettings(args[0] as never); break;
   case 'select': {
    const cards = parseCards(args[0] as string).cards.filter((_, i) => (args[1] as number[]).includes(i));
    const pages = layoutSheet(cards, DEFAULT_PAGE, (s) => s.length);
    actual = { questions: pages.filter((p) => p.kind === 'questions').flatMap((p) => p.lines.map((l) => l.text)), answers: pages.filter((p) => p.kind === 'answers').flatMap((p) => p.lines.map((l) => l.text)) }; break;
   }
   default: throw new Error('Unknown vector function');
  }
  expect(actual).toEqual(item.expected);
 });
});
