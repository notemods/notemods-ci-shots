import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { expandWithReader } from '../src/adoc/includes';
import { isSafeUrl, sanitizeHtml } from '../src/adoc/sanitize';
import { convert } from '../src/render';

const exportHtml = async (text: string, path = 'docs/doc.adoc'): Promise<string> => (await convert({ text, path, target: 'export' })).html;

// One document with each kind of block and inline markup that Asciidoctor writes in the export.
const KITCHEN_SINK = `= Kitchen sink
:toc:
:experimental:
:stem:
:sectanchors:
:sectlinks:
:sectnums:

[[top]]
== First section

A paragraph with *bold*, _italic_, \`mono\`, #mark#, [.underline]#underline#, H~2~O, E=mc^2^ and a hard +
break. A <<top,cross reference>>, an xref:other.adoc#api[inter-document xref], a https://docs.example/a?b=1&c=2[web link^],
mailto:someone@docs.example[mail], an anchor [[inline-anchor]]here, kbd:[Ctrl+C], btn:[OK], menu:File[Save As] and a
footnote.footnote:[The first note.] Inline stem:[sqrt(4) = 2] and an inline image:images/dot.png[Dot,16,16].

NOTE: An inline admonition.

[WARNING]
.Titled warning
====
A block admonition.
====

.A table
[cols="1,2,^3",options="header,footer",width=60%]
|===
|Key |Value |Notes

|a |1 |first
2+|spans two columns |x
.2+|spans two rows |2 |y
|3 |z

|Sum |6 |
|===

[%autowidth,frame=ends,grid=rows]
|===
|auto |width
|===

.A listing
[source,js,linenums]
----
const a = 1 < 2 && "x" > 'y'; // <1>
----
<1> A callout.

....
literal text
....

[quote,A. Writer,A Book]
____
A quote.
____

[verse]
A verse line.

.Sidebar
****
Sidebar text.
****

.Example
====
Example text.
====

.Details
[%collapsible%open]
====
Hidden text.
====

. one
. two
[start=4]
. four

* [x] done
* [ ] open

[%interactive]
* [x] interactive done
* [ ] interactive open

Term:: Definition
Other::: Nested

[horizontal]
A:: B

.Flow
[#flow.left,link=https://docs.example/flow]
image::images/flow.png[Flow chart,300,200,title="A title"]

video::media/clip.mp4[width=320,options="autoplay,loop,nocontrols"]

audio::media/sound.ogg[]

[stem]
++++
sum_(i=1)^n i^3
++++

'''

<<<

[bibliography]
== References

* [[[ref1,1]]] A reference.

[appendix]
== Extra

[discrete]
=== A discrete heading

[.lead]
Lead text.

Last line.footnote:[The second note.]
`;

describe('sanitizeHtml keeps Asciidoctor output', () => {
	it('returns the export of a document with every common block byte for byte', async () => {
		const html = await exportHtml(KITCHEN_SINK);
		// The sample is only a proof when the converter did write these parts.
		for (const part of ['<div id="toc"', '<table class="tableblock', '<col style="width:', 'colspan="2"', 'rowspan="2"', '<tfoot>', '<details open>', '<input type="checkbox"', 'data-item-complete="1" checked>', '<div style="page-break-after: always;"></div>', '<video src="media/clip.mp4" width="320" autoplay loop>', '<audio src="media/sound.ogg" controls>', 'class="conum"', '<kbd>', 'target="_blank" rel="noopener"', 'href="mailto:', '<div class="stemblock">', 'id="_footnotedef_2"', '<a class="image" href="https://docs.example/flow">', 'data-lang="js"', '<mark>', 'style="width: 60%;"'])
			expect(html).toContain(part);
		expect(sanitizeHtml(html)).toBe(html);
	});

	it('returns the export of each sample note byte for byte, with the includes resolved', async () => {
		const root = join(__dirname, '..', 'docs', 'sample-notes');
		const read = (p: string): Promise<string | null> => {
			try {
				return Promise.resolve(readFileSync(join(root, p), 'utf8'));
			} catch {
				return Promise.resolve(null);
			}
		};
		const notes = readdirSync(root).filter((f) => f.endsWith('.adoc'));
		expect(notes.length).toBeGreaterThanOrEqual(2);
		for (const note of notes) {
			const expanded = await expandWithReader((await read(note)) ?? '', note, read, { resolve: true });
			expect(expanded.includes.filter((i) => i.status !== 'ok')).toEqual([]);
			const html = await exportHtml(expanded.text, note);
			expect(html.length).toBeGreaterThan(500);
			expect(sanitizeHtml(html)).toBe(html);
		}
	});

	it('keeps safe passthrough HTML and presentation MathML', () => {
		const html = '<figure class="x"><img src="a.png" alt="A &amp; B"><figcaption>Cap</figcaption></figure><p style="color: #c00; text-align: center">x &lt; y &amp; z</p><math display="block"><mfrac><mi>a</mi><mn>2</mn></mfrac></math><abbr title="x">y</abbr><img src="data:image/png;base64,iVBORw0KGgo=" alt="">';
		expect(sanitizeHtml(html)).toBe(html);
	});

	it('writes a link in place of the frame of a video macro', async () => {
		const html = sanitizeHtml(await exportHtml('video::dQw4w9WgXcQ[youtube]\n'));
		expect(html).not.toMatch(/<iframe/i);
		expect(html).toMatch(/<div class="videoblock">\s*<div class="content">\s*<a href="(https:\/\/www\.youtube\.com\/embed\/dQw4w9WgXcQ[^"]*)">\1<\/a>\s*<\/div>\s*<\/div>/);
	});
});

describe('sanitizeHtml removes active content', () => {
	const clean = (html: string): string => {
		const out = sanitizeHtml(html);
		expect(out).not.toMatch(/<\/?(script|style|iframe|object|embed|form|meta|link|base|svg|textarea|button|select|template|noscript|title|xmp)\b/i);
		expect(out).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i);
		expect(out).not.toMatch(/(href|src|poster|cite)="[^"]*script/i);
		return out;
	};

	it('drops scripts in every spelling, with their content', () => {
		expect(clean('a<script>x()</script>b')).toBe('ab');
		expect(clean('a<SCRIPT SRC=//h.example/x.js></SCRIPT >b')).toBe('ab');
		expect(clean('a<script/x>y()</script\n>b')).toBe('ab');
		expect(clean('a<script>never closed')).toBe('a');
		expect(clean('a<scr<script>x()</script>ipt>y()</script>b')).toBe('ax()ipt>y()b');
		expect(clean('<style>p{background:url(//h.example/t)}</style><p>t</p>')).toBe('<p>t</p>');
		expect(clean('<noscript><p title="</noscript><img src=x onerror=x()>"></noscript>')).toBe('<img src="x">">');
	});

	it('drops event handlers, unknown attributes and unsafe styles and keeps the element', () => {
		expect(clean('<img src=x onerror=x()>')).toBe('<img src="x">');
		expect(clean('<img src="x"onerror="x()">')).toBe('<img src="x">');
		expect(clean('<p ONCLICK="x()" id="a" formaction="x" srcdoc="y" is="z">t</p>')).toBe('<p id="a">t</p>');
		expect(clean('<details open ontoggle=x()><summary>s</summary></details>')).toBe('<details open><summary>s</summary></details>');
		expect(clean('<p style="width: 50%; background: url(//h.example/t); position: fixed">t</p>')).toBe('<p style="width: 50%;">t</p>');
		expect(clean('<p style="width: expression(x()); color&colon; red">t</p>')).toBe('<p>t</p>');
		expect(clean('<a title="&quot;><script>x()</script>" href="a.html">t</a>')).toBe('<a title="&quot;&gt;&lt;script&gt;x()&lt;/script&gt;" href="a.html">t</a>');
	});

	it('drops unsafe addresses and keeps the element and its text', () => {
		for (const href of ['javascript:x()', ' JAVASCRIPT:x()', 'java\tscript:x()', 'java&#10;script:x()', '&#106;avascript:x()', '&#x6A;avascript:x()', '&#0000000106avascript:x()', 'javascript&colon;x()', 'javascript&#0000000058;x()', 'jav&Tab;ascript:x()', '&#1;javascript:x()', 'vbscript:x()', 'data:text/html,<script>x()</script>', 'data:text/html;base64,PHNjcmlwdD4=', 'obsidian://open?vault=x', 'x&unknown;y:z'])
			expect(clean(`<a href="${href}">t</a>`)).toBe('<a>t</a>');
		expect(clean('<img src="data:image/svg+xml;base64,PHN2Zz4=">')).toBe('<img>');
		expect(clean('<a href="data:image/png;base64,iVBORw0KGgo=">t</a>')).toBe('<a>t</a>');
		expect(clean('<video src="javascript:x()" poster="javascript:x()"></video>')).toBe('<video></video>');
		expect(clean('<blockquote cite="javascript:x()">t</blockquote>')).toBe('<blockquote>t</blockquote>');
	});

	it('keeps relative, fragment, web, mail and file addresses', () => {
		for (const href of ['other.html#api', '#_setup', '../a/b.html?x=1&amp;y=2', '/abs/path', '//docs.example/x', 'https://docs.example/a:b', 'HTTP://docs.example/', 'mailto:a@docs.example', 'tel:+48123', 'file:///home/a.pdf', 'a%20b.html', '?q=a:b', 'dir/a:b.html'])
			expect(isSafeUrl(href, 'a', 'href')).toBe(true);
	});

	it('drops frames, objects, forms, meta and base, and keeps fallback text', () => {
		expect(clean('<iframe src="javascript:x()">in</iframe>t')).toBe('t');
		expect(clean('<iframe srcdoc="<script>x()</script>"></iframe>t')).toBe('t');
		expect(clean('<iframe src="https://frames.example/a?b=1&amp;c=2" onload="x()">in</iframe>')).toBe('<a href="https://frames.example/a?b=1&amp;c=2">https://frames.example/a?b=1&amp;c=2</a>');
		expect(clean('<object data="x.swf"><param name="a" value="b"><span>alt</span></object>')).toBe('<span>alt</span>');
		expect(clean('<embed src="x.swf"><meta http-equiv="refresh" content="0;url=//h.example/"><base href="//h.example/"><link rel="stylesheet" href="//h.example/x.css">t')).toBe('t');
		expect(clean('<form action="//h.example/"><input name="q"><input type="checkbox" checked><button formaction="x">Send</button></form>')).toBe('<input type="checkbox" checked>Send');
		expect(clean('<svg onload="x()"><script>x()</script><a xlink:href="javascript:x()">t</a></svg>after')).toBe('after');
		expect(clean('<svg/>after<math><annotation-xml encoding="text/html"><p>x</p></annotation-xml><mi>a</mi></math>')).toBe('after<math><mi>a</mi></math>');
	});

	it('drops comments, doctypes and broken markup, and closes what is left open', () => {
		expect(clean('a<!-- <script>x()</script> -->b<!DOCTYPE html><?php x ?><![CDATA[ y ]]>c')).toBe('abc');
		expect(clean('a < b and 1 <2 </ x>')).toBe('a &lt; b and 1 &lt;2 &lt;/ x>');
		expect(clean('<p>a<img src="x" title="never closed>b')).toBe('<p>a</p>');
		expect(clean('<div><p>a</div></p></div></section>b')).toBe('<div><p>a</p></div>b');
		expect(clean('<b><i>a')).toBe('<b><i>a</i></b>');
		expect(clean('<custom-el onx="1"><font color="red">t</font></custom-el>')).toBe('t');
		expect(clean("<a href=it's.html title=a\"b>t</a> <a 'x>y' href=\"a>b\">u</a>")).toBe('<a href="it\'s.html" title="a&quot;b">t</a> <a>y\' href="a>b">u</a>');
	});

	it('handles a large hostile input in linear time', () => {
		const n = 100000;
		expect(clean(`${'<b>'.repeat(n)}${'</i>'.repeat(n)}x`)).toBe(`${'<b>'.repeat(n)}x${'</b>'.repeat(n)}`);
		expect(clean(`${'<a href="x" title=\''.repeat(n)}`)).toBe('');
		expect(clean('<'.repeat(n))).toBe('&lt;'.repeat(n));
	});
});
