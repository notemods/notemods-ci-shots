import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import AsciidocFilesPlugin from '../src/main';
import type { AsciidocView } from '../src/view';
import manifest from '../manifest.json';

// The export and the copy command of the plugin, with a mock vault and a stubbed clipboard.
// Each hostile case checks both outputs: the exported page and the copied HTML body.

/** Any attribute whose name starts with "on" inside a tag (an inline event handler). */
const HANDLER = /<[a-z][^>]*\son[a-z]+\s*=/i;

async function outputs(text: string): Promise<{ page: string; copied: string }> {
	const app = App.createConfigured__({ files: { 'docs/doc.adoc': text } });
	const plugin = new AsciidocFilesPlugin(app as never, manifest as never);
	await plugin.loadSettings();
	const file = app.vault.getFileByPath('docs/doc.adoc');
	const view = { file, data: text } as unknown as AsciidocView;
	let copied = '';
	vi.stubGlobal('navigator', { clipboard: { writeText: (s: string) => ((copied = s), Promise.resolve()) } });
	const path = await plugin.exportHtml(view);
	await plugin.copyHtml(view);
	expect(path).toBe('docs/doc.html');
	const out = app.vault.getFileByPath('docs/doc.html');
	const page = out ? await app.vault.read(out) : '';
	expect(page).toMatch(/^<!DOCTYPE html>/);
	expect(copied.length).toBeGreaterThan(0);
	return { page, copied };
}

afterEach(() => vi.unstubAllGlobals());

describe('export to HTML and copy as HTML are sanitized', () => {
	it('a passthrough script is not in the export or the copy', async () => {
		const text = '= Doc\n\nBefore.\n\n++++\n<script>window.adocXss = 2;</script>\n<SCRIPT src="//x.example/a.js"></SCRIPT>\n++++\n\nInline pass:[<script>window.adocXss = 5</script>] after.\n';
		for (const html of Object.values(await outputs(text))) {
			expect(html).not.toMatch(/<script/i);
			expect(html).not.toContain('adocXss');
			expect(html).toContain('Before.');
			expect(html).toContain('after.');
		}
	});

	it('an onerror attribute is removed and the image stays', async () => {
		const text = '= Doc\n\n++++\n<img src="missing.png" onerror="window.adocXss = 1">\n<p onclick=\'x()\' ONMOUSEOVER=x()>Text</p>\n++++\n';
		for (const html of Object.values(await outputs(text))) {
			expect(html).not.toMatch(HANDLER);
			expect(html).not.toMatch(/onerror|onclick|onmouseover|adocXss/i);
			expect(html).toContain('<img src="missing.png">');
			expect(html).toContain('<p>Text</p>');
		}
	});

	it('a javascript: link loses its address, also when it is written with entities or as a link macro', async () => {
		const text = [
			'= Doc',
			'',
			'++++',
			'<a href="javascript:window.adocXss = 3">one</a>',
			'<a href=" JaVa&#115;cript:alert(1)">two</a>',
			'<a href="java&Tab;script&colon;alert(1)">three</a>',
			'<a href="data:text/html,<script>alert(1)</script>">four</a>',
			'++++',
			'',
			'link:javascript:window.adocXss=4[five]',
			'',
		].join('\n');
		for (const html of Object.values(await outputs(text))) {
			expect(html).not.toMatch(/script\s*(:|&colon;|&#)/i);
			expect(html).not.toMatch(/data:text\/html/i);
			expect(html).not.toMatch(/href="[^"]*(alert|adocXss)/);
			for (const label of ['one', 'two', 'three', 'four', 'five']) expect(html).toContain(`>${label}</a>`);
		}
	});

	it('an iframe, an object, an embed, a form and a meta refresh are not in the export or the copy', async () => {
		const text = [
			'= Doc',
			'',
			'++++',
			'<iframe src="https://frames.example/a" onload="x()">inside</iframe>',
			'<iframe srcdoc="<script>alert(1)</script>"></iframe>',
			'<object data="https://frames.example/b.swf"><span class="alt">fallback</span></object>',
			'<embed src="https://frames.example/c.swf">',
			'<form action="https://frames.example/post"><input name="q"><button>Send</button></form>',
			'<meta http-equiv="refresh" content="0;url=https://frames.example/">',
			'<base href="https://frames.example/">',
			'++++',
			'',
		].join('\n');
		for (const html of Object.values(await outputs(text))) {
			expect(html).not.toMatch(/<(iframe|object|embed|form|input|button|base)\b/i);
			expect(html).not.toMatch(/http-equiv|srcdoc/i);
			expect(html).not.toMatch(/<script/i);
			expect(html).toContain('<span class="alt">fallback</span>');
		}
		const { page } = await outputs(text);
		expect(page.match(/<meta /g)).toHaveLength(3);
	});

	it('a normal document keeps its table, listing, admonition, image and link', async () => {
		const text = [
			'= Guide',
			':toc:',
			'',
			'== Setup',
			'',
			'NOTE: Read this first.',
			'',
			'[cols="1,2"]',
			'|===',
			'|Key |Value',
			'',
			'|a |1',
			'|===',
			'',
			'[source,js]',
			'----',
			'const a = 1 < 2;',
			'----',
			'',
			'image::images/flow.png[Flow,300]',
			'',
			'See https://docs.example/start[the docs] and xref:other.adoc#api[the API].footnote:[A note.]',
			'',
		].join('\n');
		for (const html of Object.values(await outputs(text))) {
			expect(html).toContain('<h2 id="_setup">Setup</h2>');
			expect(html).toContain('<div id="toc" class="toc">');
			expect(html).toContain('<li><a href="#_setup">Setup</a></li>');
			expect(html).toContain('<div class="admonitionblock note">');
			expect(html).toContain('<table class="tableblock frame-all grid-all stretch">');
			expect(html).toContain('<col style="width: 33.3333%;">');
			expect(html).toContain('<th class="tableblock halign-left valign-top">Key</th>');
			expect(html).toContain('<pre class="highlight"><code class="language-js" data-lang="js">const a = 1 &lt; 2;</code></pre>');
			expect(html).toContain('<img src="images/flow.png" alt="Flow" width="300">');
			expect(html).toContain('<a href="https://docs.example/start">the docs</a>');
			expect(html).toContain('<a href="other.html#api">the API</a>');
			expect(html).toContain('<sup class="footnote">[<a id="_footnoteref_1" class="footnote" href="#_footnotedef_1" title="View footnote.">1</a>]</sup>');
			expect(html).toContain('<div class="footnote" id="_footnotedef_1">');
		}
	});
});
