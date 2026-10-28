import { describe, expect, it } from 'vitest';
import vectors from './vectors/fixation-reader.json';
import { processSection } from '../src/reading';
import { wordStarts } from '../src/words';
import { enabledFor } from '../src/rules';
import { DEFAULT_SETTINGS } from '../src/settings';

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
describe('golden word vectors', () => {
 for (const c of vectors.cases) it(c.name, () => {
  const [text, strength, minimum] = c.args as [string, number, number];
  expect(wordStarts(text,strength,minimum)).toEqual(c.expected);
  const el = document.createElement('div'); el.textContent = text;
  processSection(el, { ...DEFAULT_SETTINGS, strength, minimum }, true, false);
  expect(el.innerHTML.replace(/ data-fixation-reader=""/g, '')).toBe(c.expectedHtml);
  let result = '', cursor = 0;
  for (const w of wordStarts(text, strength, minimum)) {
   result += escape(text.slice(cursor,w.from)) + '<b class="fx">' + escape(text.slice(w.from,w.split)) + '</b>' + escape(text.slice(w.split,w.to)); cursor=w.to;
  }
  result += escape(text.slice(cursor));
  expect(result).toBe(c.expectedHtml);
 });
});
describe('golden DOM cases', () => {
 for (const c of vectors.domCases) it(c.name, () => {
  const el = document.createElement('div'); el.innerHTML = c.html;
  const s = { ...DEFAULT_SETTINGS, enabled: 'enabled' in c ? c.enabled : true };
  const before = el.innerHTML;
  processSection(el, s, enabledFor(s, false, 'a.md', [], 'frontmatter' in c ? c.frontmatter : null), false);
  expect(el.querySelectorAll('b.fx').length).toBe(c.expected);
  expect(el.innerHTML).toBe(before);
 });
});
for (const c of vectors.ruleCases) it(c.name, () => {
 const [pro, path, tags, frontmatter] = c.args as [boolean,string,string[],unknown];
 expect(enabledFor({ ...DEFAULT_SETTINGS, excludedFolders: 'Archive', excludedTags: 'skip' }, pro,path,tags,frontmatter)).toBe(c.expected);
});
