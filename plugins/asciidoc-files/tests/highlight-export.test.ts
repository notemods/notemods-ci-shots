import { describe, expect, it } from 'vitest';
import { escapeHtml, exportPath, localCss, standalonePage } from '../src/adoc/export';
import { inlineSpans, tokenize } from '../src/adoc/highlight';

const classes = (text: string) => tokenize(text).map((spans) => spans.map((s) => s.cls));

describe('source tokens', () => {
	it('classifies structure lines and verbatim blocks', () => {
		const text = ['= Title', ':toc: left', '[source,js]', '----', '== not a heading', '----', '// note', 'NOTE: careful', '* item', '.Caption'].join('\n');
		expect(classes(text)).toEqual([
			['heading heading-1'],
			['attr-name', 'attr-value'],
			['meta'],
			['delim'],
			['code'],
			['delim'],
			['comment'],
			['admonition'],
			['list'],
			['block-title'],
		]);
	});
	it('comment blocks hide everything until they close', () => {
		expect(classes('////\n= x\n////\n= y')).toEqual([['delim'], ['comment'], ['delim'], ['heading heading-1']]);
	});
	it('inline marks do not overlap', () => {
		const spans = inlineSpans('A *bold* and `mono` with xref:a.adoc[A] and {attr}.');
		expect(spans.map((s) => s.cls)).toEqual(['strong', 'mono', 'macro', 'attr-ref']);
		for (let i = 1; i < spans.length; i++) expect(spans[i]!.from).toBeGreaterThanOrEqual(spans[i - 1]!.to);
	});
});

describe('export page', () => {
	it('puts the body in a complete page with an escaped title and no remote CSS', () => {
		const page = standalonePage({ title: 'A <b> & "c"', body: '<p>x</p>', css: '@import "https://fonts.example/x";\nbody{color:#000}', lang: 'de' });
		expect(page).toContain('<html lang="de">');
		expect(page).toContain('<title>A &lt;b&gt; &amp; &quot;c&quot;</title>');
		expect(page).toContain('<div id="content">\n<p>x</p>\n</div>');
		expect(page).not.toContain('https://');
		expect(page).not.toMatch(/<script/i);
	});
	it('falls back to en for a bad lang and maps the path', () => {
		expect(standalonePage({ title: 't', body: '', css: '', lang: '"><script>' })).toContain('<html lang="en">');
		expect(exportPath('docs/guide.adoc')).toBe('docs/guide.html');
		expect(localCss('@import url(//x.y/z.css);a{}')).toBe('a{}');
		expect(escapeHtml('<&>')).toBe('&lt;&amp;&gt;');
	});
});
