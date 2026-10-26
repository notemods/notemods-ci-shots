import { describe, expect, it } from 'vitest';
import { classifyHref, findBacklinks, resolveXrefs } from '../src/adoc/links';
import { baseName, dirOf, extOf, isAdocPath, isUrl, joinPath, withExt } from '../src/adoc/paths';

describe('paths', () => {
	it('joins, normalizes and refuses to leave the vault', () => {
		expect(joinPath('a/b', '../c/./d.adoc')).toBe('a/c/d.adoc');
		expect(joinPath('a/b', '/top.adoc')).toBe('top.adoc');
		expect(joinPath('', '../x')).toBeNull();
		expect(dirOf('x.adoc')).toBe('');
		expect(baseName('a/b/c.adoc')).toBe('c.adoc');
		expect(extOf('a/b.ADOC')).toBe('adoc');
		expect(extOf('a/.hidden')).toBe('');
		expect(withExt('a/b.adoc', 'html')).toBe('a/b.html');
		expect(isAdocPath('x.asciidoc')).toBe(true);
		expect(isAdocPath('x.md')).toBe(false);
	});
	it('tells URLs from paths, including Windows drive letters', () => {
		expect(isUrl('https://x.y')).toBe(true);
		expect(isUrl('mailto:a@b.c')).toBe(true);
		expect(isUrl('C:\\docs\\a.adoc')).toBe(false);
		expect(isUrl('docs/a.adoc')).toBe(false);
	});
});

describe('classifyHref', () => {
	it('in-page anchors, files with fragments, external links and refused schemes', () => {
		expect(classifyHref('#_setup', 'd/a.adoc')).toEqual({ kind: 'anchor', fragment: '_setup' });
		expect(classifyHref('other.adoc#api', 'd/a.adoc')).toEqual({ kind: 'file', path: 'd/other.adoc', fragment: 'api' });
		expect(classifyHref('../b.html', 'd/a.adoc')).toEqual({ kind: 'file', path: 'b.adoc', fragment: null });
		expect(classifyHref('my%20doc.adoc', 'a.adoc')).toEqual({ kind: 'file', path: 'my doc.adoc', fragment: null });
		expect(classifyHref('https://asciidoc.org', 'a.adoc')).toEqual({ kind: 'external', url: 'https://asciidoc.org' });
		expect(classifyHref('javascript:alert(1)', 'a.adoc')).toEqual({ kind: 'none' });
		expect(classifyHref('file:///etc/passwd', 'a.adoc')).toEqual({ kind: 'none' });
		expect(classifyHref(null, 'a.adoc')).toEqual({ kind: 'none' });
		expect(classifyHref('../../x.adoc', 'a.adoc')).toEqual({ kind: 'none' });
	});
});

describe('xrefs and backlinks', () => {
	it('marks missing files and missing in-document anchors', () => {
		const src = '== Here\n<<_here>> <<nowhere>> xref:b.adoc[] xref:gone.adoc[]';
		const r = resolveXrefs('d/a.adoc', src, (p) => p === 'd/b.adoc');
		expect(r.map((x) => [x.path, x.ok])).toEqual([
			['d/a.adoc', true],
			['d/a.adoc', false],
			['d/b.adoc', true],
			['d/gone.adoc', false],
		]);
	});
	it('finds xrefs and includes in other documents that point to a file', () => {
		const docs = [
			{ path: 'd/a.adoc', text: 'x' },
			{ path: 'd/b.adoc', text: 'See xref:a.adoc#top[].\ninclude::a.adoc[]' },
			{ path: 'c.adoc', text: '<<d/a.adoc#x,A>> and <<a.adoc#y>>' },
		];
		expect(findBacklinks('d/a.adoc', docs).map((b) => [b.from, b.line, b.kind])).toEqual([
			['c.adoc', 0, 'xref'],
			['d/b.adoc', 0, 'xref'],
			['d/b.adoc', 1, 'include'],
		]);
	});
});
