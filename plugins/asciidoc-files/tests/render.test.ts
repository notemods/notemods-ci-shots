import { describe, expect, it } from 'vitest';
import { expandIncludes } from '../src/adoc/includes';
import { convert } from '../src/render';

describe('convert (Asciidoctor.js 3.0.4, safe mode)', () => {
	it('renders the title, a section and a table', async () => {
		const out = await convert({ text: '= Guide\n:lang: de\n\n== Setup\n\n|===\n|Key |Value\n\n|a |1\n|===\n', path: 'docs/guide.adoc', target: 'preview' });
		expect(out.title).toBe('Guide');
		expect(out.lang).toBe('de');
		expect(out.html).toContain('<h1>Guide</h1>');
		expect(out.html).toContain('<h2 id="_setup">Setup</h2>');
		expect(out.html).toMatch(/<table class="tableblock[^"]*">/);
		expect(out.warnings).toEqual([]);
	});
	it('writes inter-document xrefs as .adoc in the preview and .html in exports', async () => {
		const text = 'See xref:other.adoc#api[the API].';
		expect((await convert({ text, path: 'a.adoc', target: 'preview' })).html).toContain('href="other.adoc#api"');
		expect((await convert({ text, path: 'a.adoc', target: 'export' })).html).toContain('href="other.html#api"');
	});
	it('collects warnings instead of logging them', async () => {
		const out = await convert({ text: '== A\n\nSee <<nowhere>>.\n\n{missing-attr}', path: 'a.adoc', target: 'preview' });
		expect(out.warnings.join('\n')).toMatch(/missing-attr/);
	});
	it('expanded includes with leveloffset render as nested sections', async () => {
		const ex = expandIncludes('= Book\n\n== Part\n\ninclude::ch.adoc[leveloffset=+1]\n\n== After', 'book.adoc', { 'ch.adoc': '== Chapter\n\nBody.' });
		const out = await convert({ text: ex.text, path: 'book.adoc', target: 'preview' });
		expect(out.html).toContain('<h3 id="_chapter">Chapter</h3>');
		expect(out.html).toContain('<h2 id="_after">After</h2>');
	});
	it('does not read files or URLs in safe mode (include left for the plugin to resolve)', async () => {
		const out = await convert({ text: 'include::/etc/hosts[]', path: 'a.adoc', target: 'preview' });
		expect(out.html).not.toContain('localhost');
	});
});
