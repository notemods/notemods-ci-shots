import { describe, expect, it } from 'vitest';
import { check, markdownReport, previewFixes } from '../src/checker';
const rules = (columns: unknown) => JSON.stringify({ columns });
describe('review defects', () => {
 it('keeps CSV values inert in reports so they add no tags, highlights, math or comments', () => {
  const report = markdownReport('a.csv', check('v\n#urgent ==hi== $x$ 50%% ~~s~~', rules({ v: { enum: [] } })));
  expect(report).not.toMatch(/#urgent|==|\$x\$|%%|~~/);
 });
 it('uses the record separator of the source, not a line break inside a quoted field', () => {
  const p = previewFixes('id,note\n1,"a\r\nb"\n2, x \n', rules({ note: { trim: true } }));
  expect(p.csv).toBe('"id","note"\n"1","a\r\nb"\n"2","x"');
 });
 it('uses singular words for one record and one error', () => {
  expect(markdownReport('a.csv', check('v\nx', rules({ v: { enum: [] } })))).toContain('1 data record. 1 error. 1 error shown.');
 });
});
