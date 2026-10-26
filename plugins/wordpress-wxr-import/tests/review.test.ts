import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { markdown, planImport } from '../src/model';
import { parseWxr } from '../src/parser';
const xml = readFileSync('tests/fixtures/three-records.xml', 'utf8');
describe('review findings', () => {
 it('uses the local date when a draft has a zero GMT date', () => {
  const draft = xml.replace('<wp:post_date_gmt>2024-12-17 10:00:00</wp:post_date_gmt>', '<wp:post_date>2024-12-17 12:00:00</wp:post_date><wp:post_date_gmt>0000-00-00 00:00:00</wp:post_date_gmt>')
   .replace('<wp:comment_date_gmt>2024-12-18 12:00:00</wp:comment_date_gmt>', '<wp:comment_date>2024-12-18 14:00:00</wp:comment_date><wp:comment_date_gmt>0000-00-00 00:00:00</wp:comment_date_gmt>');
  const record = parseWxr(draft).records[0]!;
  expect(record.created).toBe('2024-12-17 12:00:00'); expect(record.comments[0]?.date).toBe('2024-12-18 14:00:00');
  expect(planImport(draft, 'Import').files[0]?.content).not.toContain('0000-00-00');
 });
 it('keeps the GMT date when it is valid', () => {
  const both = xml.replace('<wp:post_date_gmt>2024-12-17 10:00:00</wp:post_date_gmt>', '<wp:post_date>2024-12-17 12:00:00</wp:post_date><wp:post_date_gmt>2024-12-17 10:00:00</wp:post_date_gmt>');
  expect(parseWxr(both).records[0]?.created).toBe('2024-12-17 10:00:00');
 });
 it('does not nest a media link in a linked image', () => {
  const text = markdown('<p><a href="https://example.org/full.jpg"><img src="https://example.org/thumb.jpg" alt="Photo"></a></p>');
  expect(text).toBe('[Photo](https://example.org/full.jpg)');
 });
});
