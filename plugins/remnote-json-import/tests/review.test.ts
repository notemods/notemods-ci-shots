import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, planImport } from '../src/importer';

describe('review defects', () => {
 it('rejects a nested root that is listed before its ancestor', () => {
  const text = JSON.stringify({ docs: [{ _id: 'a', key: ['A'] }, { _id: 'b', parent: 'a', key: ['B'] }] });
  expect(() => planImport(text, { ...DEFAULT_LAYOUT, groupRoots: ['b', 'a'] })).toThrow('overlap');
  expect(() => planImport(text, { ...DEFAULT_LAYOUT, groupRoots: ['a', 'b'] })).toThrow('overlap');
 });
 it('escapes comment and math markers so source text stays visible', () => {
  const text = JSON.stringify({ docs: [{ _id: 'a', key: ['Cost $5 and $10'], value: ['Draft %% hidden %% end'], references: ['b'] }, { _id: 'b', key: ['B'] }] });
  const content = planImport(text).notes.find(n => n.ids[0] === 'a')!.content;
  expect(content).not.toMatch(/(^|[^\\])%%/);
  expect(content).not.toMatch(/(^|[^\\])\$5/);
  expect(content).toContain('References:');
 });
});
