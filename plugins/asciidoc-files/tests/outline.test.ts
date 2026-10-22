import { describe, expect, it } from 'vitest';
import { extractOutline, plainTitle, sectionId, splitXrefTarget, xrefPath } from '../src/adoc/outline';

describe('section ids (Asciidoctor defaults)', () => {
	it.each([
		['Getting Started', '_getting_started'],
		['What is *new* in 2.0?', '_what_is_new_in_2_0'],
		['A -- B', '_a_b'],
		['Über uns', '_über_uns'],
		['`code` & more', '_code_more'],
	])('%s -> %s', (title, id) => {
		expect(sectionId(title)).toBe(id);
	});
	it('plain title drops inline marks', () => {
		expect(plainTitle('The *bold* and _em_ part')).toBe('The bold and em part');
	});
});

describe('outline', () => {
	const src = [
		'= Guide',
		':toc:',
		'',
		'[[intro]]',
		'== Introduction',
		'See <<setup>> and <<other.adoc#api,the API>>.',
		'',
		'== Setup',
		'xref:ref/cli.adoc[CLI] and xref:faq.adoc#top[] and https://x.example[web].',
		'[#tbl.wide]',
		'.Table title',
		'|===',
		'|a',
		'|===',
		'----',
		'== Not a section',
		'<<inside>>',
		'----',
		'// == comment',
		'== Setup',
		'A [[spot]] anchor and anchor:mark[].',
	].join('\n');
	const o = extractOutline(src);
	it('finds sections with explicit and generated ids, skipping listings and comments', () => {
		expect(o.sections.map((s) => [s.level, s.title, s.id, s.line])).toEqual([
			[0, 'Guide', '_guide', 0],
			[1, 'Introduction', 'intro', 4],
			[1, 'Setup', '_setup', 7],
			[1, 'Setup', '_setup_2', 19],
		]);
	});
	it('finds block and inline anchors', () => {
		expect(o.anchors.filter((a) => a.kind !== 'section').map((a) => a.id)).toEqual(['tbl', 'spot', 'mark']);
	});
	it('finds internal and inter-document xrefs, not URLs', () => {
		expect(o.xrefs.map((x) => [x.file, x.fragment, x.text])).toEqual([
			[null, 'setup', ''],
			['other.adoc', 'api', 'the API'],
			['ref/cli.adoc', null, 'CLI'],
			['faq.adoc', 'top', ''],
		]);
	});
});

describe('xref targets', () => {
	it('splits documents and fragments as Asciidoctor reads them', () => {
		expect(splitXrefTarget('other#sec', false)).toEqual({ file: 'other', fragment: 'sec' });
		expect(splitXrefTarget('sec', false)).toEqual({ file: null, fragment: 'sec' });
		expect(splitXrefTarget('doc.adoc', false)).toEqual({ file: 'doc.adoc', fragment: null });
		expect(splitXrefTarget('#sec', false)).toEqual({ file: null, fragment: 'sec' });
	});
	it('maps document parts to vault paths', () => {
		expect(xrefPath('docs/a.adoc', 'b')).toBe('docs/b.adoc');
		expect(xrefPath('docs/a.adoc', '../c.html')).toBe('c.adoc');
		expect(xrefPath('docs/a.adoc', 'sub/my%20doc.asciidoc')).toBe('docs/sub/my doc.asciidoc');
		expect(xrefPath('a.adoc', '../../out.adoc')).toBeNull();
	});
});

describe('leveloffset in the outline', () => {
	it('shifts the levels of sections between leveloffset entries', () => {
		const o = extractOutline('= Book\n\n:leveloffset: +1\n= Chapter\n== Part\n\n:leveloffset: -1\n== After\n:leveloffset: 3\n= Deep\n:leveloffset!:\n== Back');
		expect(o.sections.map((s) => [s.title, s.level])).toEqual([
			['Book', 0],
			['Chapter', 1],
			['Part', 2],
			['After', 1],
			['Deep', 3],
			['Back', 1],
		]);
	});
});
