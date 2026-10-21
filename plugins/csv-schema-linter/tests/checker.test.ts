import { describe, expect, it } from 'vitest';
import { check, markdownReport, MAX_BYTES, parseSchema, previewFixes } from '../src/checker';
const rules = (columns: unknown) => JSON.stringify({ columns });
describe('bounds and malformed rules', () => {
 it('rejects UTF-8 input above 5 MiB and accepts the exact boundary', () => {
  expect(() => check('a'.repeat(MAX_BYTES + 1), rules({}))).toThrow('5 MiB');
  expect(() => check('é'.repeat(MAX_BYTES / 2 + 1), rules({}))).toThrow('5 MiB');
  expect(check('a'.repeat(MAX_BYTES), rules({})).total).toBe(0);
 });
 it('rejects malformed and unknown rules before CSV parsing', () => {
  for (const value of ['{', '{}', '{"columns":[]}', rules({ a: { type: 'date' } }), rules({ a: { required: 'yes' } }), rules({ a: { enum: [1] } }), rules({ a: { default: 1 } }), rules({ a: { unknown: true } })]) expect(() => parseSchema(value)).toThrow();
  expect(() => check('a,a', '{}')).toThrow('columns');
 });
 it('stores 500 errors but counts the remaining errors', () => {
  const result = check('age\n' + Array.from({ length: 700 }, () => 'xx').join('\n'), rules({ age: { type: 'number' } }));
  expect(result.total).toBe(700); expect(result.errors).toHaveLength(500);
 });
 it('escapes Markdown and HTML in reports', () => {
  const report = markdownReport('bad|<name>.csv', check('name\n"<script>|[[x]]"', rules({ name: { enum: [] } })));
  expect(report).not.toContain('<script>'); expect(report).not.toContain('[[x]]'); expect(report).toContain('&#124;');
 });
});
describe('fix preview', () => {
 it('trims before defaults, shows exact changes, and keeps identifiers as text', () => {
  const schema = rules({ id: { type: 'string' }, name: { trim: true, default: 'Unknown', required: true } });
  const p = previewFixes('\uFEFFid,name\r\n001, Ada \r\n002,   \r\n', schema);
  expect(p.changes).toEqual([{ row: 2, column: 'name', before: ' Ada ', after: 'Ada' }, { row: 3, column: 'name', before: '   ', after: 'Unknown' }]);
  expect(p.result.total).toBe(0); expect(p.result.rows[0]?.[0]).toBe('001'); expect(p.csv.startsWith('\uFEFF')).toBe(true); expect(p.csv).toContain('\r\n');
 });
 it('leaves validation errors which trim and defaults cannot fix', () => { const p = previewFixes('age\nxx', rules({ age: { trim: true, type: 'number' } })); expect(p.total).toBe(0); expect(p.result.total).toBe(1); });
 it('refuses malformed structure before fixes', () => { expect(() => previewFixes('id,name\nA', rules({ name: { default: 'X' } }))).toThrow('structure'); });
});
