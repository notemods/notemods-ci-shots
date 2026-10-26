import { describe, expect, it } from 'vitest';
import vectors from './vectors/task-format-bridge.json';
import { convert, MAX_CHARS, type Format } from '../src/convert';
describe('golden acceptance vectors', () => {
 for (const c of vectors.cases) it(c.name, () => {
  const [text, target] = c.args as [string, Format]; const r = convert(text, target);
  expect(r).toEqual(c.expected);
  expect(convert(r.text, target).changes).toEqual([]);
 });
});
describe('safe limits', () => {
 it('keeps quoted indented code unchanged', () => { const source = '>     - [ ] Code 📅 2026-10-18'; expect(convert(source, 'dataview').changes).toEqual([]); });
 it('keeps nested list fences and converts the task after the fence', () => { const text = '- ```md\n  - [ ] Code 📅 2026-10-18\n  ```\n- [ ] Real 📅 2026-10-18'; expect(convert(text, 'dataview').text).toBe('- ```md\n  - [ ] Code 📅 2026-10-18\n  ```\n- [ ] Real [due:: 2026-10-18]'); });
 it('rejects an oversized input without partial changes', () => { const text = '- [ ] A 📅 2026-10-18\n' + 'x'.repeat(MAX_CHARS); expect(convert(text, 'dataview')).toEqual({ text, changes: [], warnings: [{ line: 1, reason: 'Note exceeds the 1,000,000 character limit.' }] }); });
 it('preserves supported values in a round trip', () => {
  const text = '- [ ] A 🔺 🔁 every day 🛫 2026-10-17 📅 2026-10-18 🆔 a1 ⛔ b1,c2 🏁 keep ^block';
  expect(convert(convert(text, 'dataview').text, 'emoji').text).toBe(text);
 });
});
describe('review regressions', () => {
 it.each(['📅', '📆', '🗓', '🗓️'])('converts due alias %s', (symbol) => {
  const source = `- [ ] Due ${symbol} 2024-01-01`;
  expect(convert(source, 'dataview').text).toBe('- [ ] Due [due:: 2024-01-01]');
  expect(convert(source, 'emoji')).toEqual({ text: source, changes: [], warnings: [] });
 });
 it.each(['⏳', '⌛'])('converts scheduled alias %s', (symbol) => {
  expect(convert(`- [ ] Scheduled ${symbol} 2024-01-01`, 'dataview').text).toBe('- [ ] Scheduled [scheduled:: 2024-01-01]');
 });
 it('rejects duplicate aliases and invalid alias dates', () => {
  for (const source of ['- [ ] A 📆 2024-01-01 🗓 2024-01-02', '- [ ] A ⌛ 2024-02-30']) {
   expect(convert(source, 'dataview')).toMatchObject({ text: source, changes: [], warnings: [{ line: 1 }] });
  }
 });
 it.each(['\t', '    ', ' \t'])('preserves nested prefix %j in both directions', (indent) => {
  const source = `- [ ] Parent\r\n${indent}- [x] Child 📅 2024-01-01\r\n${indent}${indent}1. [/] Grandchild ⏳ 2024-01-02`;
  const target = `- [ ] Parent\r\n${indent}- [x] Child [due:: 2024-01-01]\r\n${indent}${indent}1. [/] Grandchild [scheduled:: 2024-01-02]`;
  expect(convert(source, 'dataview')).toMatchObject({ text: target, warnings: [] });
  expect(convert(target, 'emoji').text).toBe(source);
 });
 it('converts a quoted nested task under an ordinary list parent', () => {
  expect(convert('> - Parent\n>     - [ ] Child 📆 2024-01-01', 'dataview').text).toBe('> - Parent\n>     - [ ] Child [due:: 2024-01-01]');
 });
 it('clears list context after a paragraph or quote boundary', () => {
  for (const source of ['- Parent\nParagraph\n    - [ ] Code 📅 2024-01-01', '> - Parent\n    - [ ] Code 📅 2024-01-01']) expect(convert(source, 'dataview').changes).toEqual([]);
 });
 it.each(['`%%`', '``a ` %% b``', '`<!--`'])('ignores comment markers in code %s', (code) => {
  const source = `- [ ] Use ${code} 📅 2024-01-01\n- [ ] Next ⌛ 2024-01-02`;
  expect(convert(source, 'dataview')).toMatchObject({ text: `- [ ] Use ${code} [due:: 2024-01-01]\n- [ ] Next [scheduled:: 2024-01-02]`, warnings: [] });
 });
 it.each(['%%hidden%%', '<!--hidden-->'])('warns about a matched inline comment %s', (comment) => {
  const source = `- [ ] Task ${comment} 📅 2024-01-01\n- [ ] Next 📅 2024-01-02`;
  const result = convert(source, 'dataview');
  expect(result.text).toBe(`- [ ] Task ${comment} 📅 2024-01-01\n- [ ] Next [due:: 2024-01-02]`);
  expect(result.warnings).toEqual([{ line: 1, reason: 'Comment on task line. Line kept.' }]);
 });
 it('keeps comment types independent and ignores fences inside comments', () => {
  const source = '%%\n<!-- ```\n- [ ] Hidden 📅 2024-01-01\n%%\n- [ ] Visible 📅 2024-01-02';
  expect(convert(source, 'dataview').text).toBe('%%\n<!-- ```\n- [ ] Hidden 📅 2024-01-01\n%%\n- [ ] Visible [due:: 2024-01-02]');
 });
 it('keeps real percent comments active when their contents contain backticks', () => {
  const source = '%% `\n- [ ] Hidden 📅 2024-01-01\n` %%\n- [ ] Visible 📅 2024-01-02';
  expect(convert(source, 'dataview').text).toBe('%% `\n- [ ] Hidden 📅 2024-01-01\n` %%\n- [ ] Visible [due:: 2024-01-02]');
 });
 it.each([' #tag', '\t#one/two  #日本語_tag ^anchor  '])('keeps trailing tags %j in both directions', (tail) => {
  const source = `- [ ] Task 📅 2024-01-01${tail}`;
  const target = `- [ ] Task [due:: 2024-01-01]${tail}`;
  expect(convert(source, 'dataview')).toMatchObject({ text: target, warnings: [] });
  expect(convert(target, 'emoji').text).toBe(source);
 });
 it('does not treat a numeric hashtag as a tag', () => {
  const source = '- [ ] Task 📅 2024-01-01 #123';
  expect(convert(source, 'dataview')).toMatchObject({ text: source, changes: [], warnings: [{ line: 1 }] });
 });
});
