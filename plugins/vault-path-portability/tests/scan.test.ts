import { describe, expect, it } from 'vitest';
import { fold, lengthScope, markdownReport, scanPaths, suggestPath } from '../src/scan';
import vectors from './vectors/vault-path-portability.json';

describe('golden acceptance cases', () => {
	for (const c of vectors.cases) it(c.name, () => expect(scanPaths(c.args[0])).toEqual(c.expected));
});
describe('safe suggestions and edge cases', () => {
	it('does not mutate input', () => { const paths = Object.freeze(['CON.md', 'a.md']); scanPaths(paths); expect(paths).toEqual(['CON.md', 'a.md']); });
	it('deduplicates indexed entries', () => expect(scanPaths(['a.md', 'a.md'])).toEqual([]));
	it('ignores the root', () => expect(scanPaths(['/', ''])).toEqual([]));
	it('folds sharp s', () => expect(fold('Straße.md')).toBe(fold('STRASSE.md')));
	it('folds final sigma', () => expect(fold('ς.md')).toBe(fold('Σ.md')));
	it('keeps Turkish dotless i distinct', () => expect(fold('ı.md')).not.toBe(fold('I.md')));
	it('does not compatibility-normalize full-width letters', () => expect(scanPaths(['Ａ.md', 'A.md'])).toEqual([]));
	it('keeps different directories distinct', () => expect(scanPaths(['a/Note.md', 'b/note.md'])).toEqual([]));
	it('suggests a reserved name with its extension', () => expect(suggestPath('CON.md', ['CON.md'])).toBe('_CON.md'));
	it('avoids case-insensitive occupied targets', () => expect(suggestPath('CON.md', ['CON.md', '_con.md'])).toBe('_CON-2.md'));
	it('avoids normalization-equivalent targets', () => expect(suggestPath('Café.md', ['Café.md', 'Cafe\u0301.md'])).toBe('Café-2.md'));
	it('cleans a forbidden leaf', () => expect(suggestPath('a?/b*.md', ['a?/b*.md'])).toBeNull());
	it('cleans an isolated forbidden leaf', () => expect(suggestPath('what?.md', ['what?.md'])).toBe('what-.md'));
	it('removes a trailing dot', () => expect(suggestPath('note.md.', ['note.md.'])).toBe('note.md'));
	it('does not treat folder dots as extensions', () => expect(suggestPath('CON.work', ['CON.work'], true)).toBe('_CON.work'));
	it('never returns the original path', () => expect(suggestPath('a.md', ['a.md'])).toBe('a-2.md'));
	it('shortens a long name', () => { const path = 'a'.repeat(270) + '.md'; const target = suggestPath(path, [path]); expect(target?.endsWith('.md')).toBe(true); expect(target!.length).toBeLessThanOrEqual(260); expect(scanPaths([target!])).toEqual([]); });
	it('declines a parent that is too long', () => expect(suggestPath('a'.repeat(261) + '/b.md', [])).toBeNull());
	it('does not split a surrogate pair', () => { const p = '😀'.repeat(140) + '.md'; const target = suggestPath(p, [p])!; expect(target).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/u); });
	it('escapes line breaks in copied reports', () => expect(markdownReport([{ rule: 'illegal-character', paths: ['x\ny.md'] }])).toContain('x\\ny.md'));
	it('declines a colliding parent', () => expect(suggestPath('Notes/a.md', ['Notes', 'notes', 'Notes/a.md'])).toBeNull());
	it('uses a longer code fence for backticks', () => expect(markdownReport([{ rule: 'illegal-character', paths: ['a`?.md'] }])).toContain('`` a`?.md ``'));
	it('has an honest empty report', () => expect(markdownReport([])).toContain('No indexed path issues found'));
	it('includes every collision member in Markdown', () => { const s = markdownReport(scanPaths(['Note.md', 'note.md'])); expect(s).toContain('` Note.md `'); expect(s).toContain('` note.md `'); });
});


describe('length and index boundaries', () => {
 it('does not advertise normalization twins as a detected rule', () => expect(scanPaths(['Café.md', 'Cafe\u0301.md'])).toEqual([]));
 it('counts desktop root and NUL at the exact boundary', () => {
  const path = 'a'.repeat(250);
  expect(scanPaths([path], 'C:/vault')).toEqual([]);
  expect(scanPaths([path + 'a'], 'C:/vault')).toEqual([{ rule: 'long-path', paths: [path + 'a'] }]);
 });
 it('counts roots with trailing separators once', () => expect(scanPaths(['a'.repeat(251)], 'C:/vault/')).toEqual(scanPaths(['a'.repeat(251)], 'C:/vault')));
 it('detects a long absolute path with short components', () => {
  const path = 'a/'.repeat(100) + 'b.md';
  expect(scanPaths([path])).toEqual([]);
  expect(scanPaths([path], 'C:/' + 'v'.repeat(60))).toEqual([{ rule: 'long-path', paths: [path] }]);
 });
 it('discloses an unavailable root in copied reports', () => expect(markdownReport([])).toContain('Absolute vault root unavailable'));
 it('describes the desktop scope', () => expect(lengthScope('C:/vault')).toContain('current absolute vault root'));
 it('allows exactly 255 UTF-8 bytes in a component', () => expect(scanPaths(['中'.repeat(85)])).toEqual([]));
 it('detects 256 UTF-8 bytes in a component', () => { const path = '中'.repeat(85) + 'a'; expect(scanPaths([path])).toEqual([{ rule: 'long-name', paths: [path] }]); });
 it('shortens multibyte suggestions to 255 bytes', () => { const target = suggestPath('中'.repeat(100) + '.md', [])!; expect(new TextEncoder().encode(target).length).toBeLessThanOrEqual(255); expect(scanPaths([target])).toEqual([]); });
 it('shortens suggestions to fit the desktop absolute path budget', () => { const root = 'C:/' + 'v'.repeat(120); const target = suggestPath('a'.repeat(200) + '.md', [], false, root)!; expect(scanPaths([target], root)).toEqual([]); });
 for (const char of ['#', '^', '[', ']', '|']) it(`separately flags link delimiter ${char}`, () => { const path = `a${char}.md`; expect(scanPaths([path])).toContainEqual({ rule: 'link-character', paths: [path] }); expect(suggestPath(path, [])).toBe('a-.md'); });
});
