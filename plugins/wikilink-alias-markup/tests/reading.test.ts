import { describe, expect, it } from 'vitest';
import type { MarkdownPostProcessorContext, MarkdownSectionInformation } from 'obsidian';
import { DONE_CLASS, ReadingView, type MathApi } from '../src/reading';
import type { Options } from '../src/settings';

function ctx(text: string | null): MarkdownPostProcessorContext {
	const info: MarkdownSectionInformation | null = text === null ? null : { text, lineStart: 0, lineEnd: text.split('\n').length - 1 };
	return { docId: 'd', sourcePath: 'a.md', frontmatter: undefined, addChild: () => undefined, getSectionInfo: () => info } as unknown as MarkdownPostProcessorContext;
}

function section(html: string): HTMLElement {
	const div = document.createElement('div');
	div.innerHTML = html;
	document.body.appendChild(div);
	return div;
}

const free = (): Options => ({ livePreview: true, math: false });
const pro = (): Options => ({ livePreview: true, math: true });

function fakeMath(): MathApi & { loads: number; release: () => void } {
	let release: () => void = () => undefined;
	const gate = new Promise<void>((r) => (release = r));
	const api = {
		loads: 0,
		release: () => release(),
		load: () => {
			api.loads++;
			return gate;
		},
		render: (src: string) => {
			const el = document.createElement('span');
			el.className = 'math math-inline';
			el.textContent = `M(${src})`;
			return el;
		},
		finish: () => undefined,
	};
	return api;
}

describe('Reading view', () => {
	it('A1 puts a code element inside the core link and keeps the link attributes', () => {
		const el = section('<p><a data-href="Obsidian" href="Obsidian" class="internal-link">`obsidian`</a></p>');
		void new ReadingView(free).process(el, ctx('[[Obsidian|`obsidian`]]'));
		const a = el.querySelector('a')!;
		expect(a.innerHTML).toBe('<code>obsidian</code>');
		expect(a.getAttribute('data-href')).toBe('Obsidian');
		expect(a.classList.contains('internal-link')).toBe(true);
		expect(a.classList.contains(DONE_CLASS)).toBe(true);
	});

	it('A3 renders bold, italic, strikethrough and highlight', () => {
		const el = section('<p><a data-href="N" class="internal-link">**b** *i* ~~s~~ ==h==</a></p>');
		void new ReadingView(free).process(el, ctx('[[N|**b** *i* ~~s~~ ==h==]]'));
		expect(el.querySelector('a')!.innerHTML).toBe('<strong>b</strong> <em>i</em> <del>s</del> <mark>h</mark>');
	});

	it('A9 leaves a link without alias as it is, also with underscores and stars', () => {
		const el = section('<p><a data-href="my_*note*" class="internal-link">my_*note*</a></p>');
		void new ReadingView(free).process(el, ctx('[[my_*note*]]'));
		expect(el.querySelector('a')!.innerHTML).toBe('my_*note*');
	});

	it('A9 uses the source order when the same target has a link with and without alias', () => {
		const el = section('<p><a data-href="N" class="internal-link">N</a> <a data-href="N" class="internal-link">*x*</a></p>');
		void new ReadingView(free).process(el, ctx('[[N]] [[N|*x*]]'));
		const [a, b] = Array.from(el.querySelectorAll('a'));
		expect(a!.innerHTML).toBe('N');
		expect(b!.innerHTML).toBe('<em>x</em>');
	});

	it('A9 skips a link whose text is not the source alias', () => {
		const el = section('<p><a data-href="N" class="internal-link">*changed*</a></p>');
		void new ReadingView(free).process(el, ctx('[[N|*x*]]'));
		expect(el.querySelector('a')!.innerHTML).toBe('*changed*');
	});

	it('A8 table cell with an escaped pipe in the source', () => {
		const el = section('<table><tbody><tr><td><a data-href="Note" class="internal-link">`x`</a></td></tr></tbody></table>');
		void new ReadingView(free).process(el, ctx('| a |\n| - |\n| [[Note\\|`x`]] |'));
		expect(el.querySelector('td a')!.innerHTML).toBe('<code>x</code>');
	});

	it('A8 nested callout without section info uses the link text when it is not the default text', () => {
		const el = section('<div class="callout"><div class="callout"><p><a data-href="Note" class="internal-link">*deep*</a> <a data-href="a_b_" class="internal-link">a_b_</a></p></div></div>');
		void new ReadingView(free).process(el, ctx(null));
		const [a, b] = Array.from(el.querySelectorAll('a'));
		expect(a!.innerHTML).toBe('<em>deep</em>');
		expect(b!.innerHTML).toBe('a_b_');
	});

	it('does not touch links inside code or a link with child elements', () => {
		const el = section('<p><code><a data-href="N" class="internal-link">*x*</a></code> <a data-href="M" class="internal-link"><span>*y*</span></a></p>');
		void new ReadingView(free).process(el, ctx(null));
		expect(el.querySelectorAll('.' + DONE_CLASS).length).toBe(0);
	});

	it('A12 free shows math as text', () => {
		const el = section('<p><a data-href="ammonia" class="internal-link">$NH_3$</a></p>');
		void new ReadingView(free).process(el, ctx('[[ammonia|$NH_3$]]'));
		expect(el.querySelector('a')!.innerHTML).toBe('$NH_3$');
	});

	it('A12 Pro renders math after MathJax loads', async () => {
		const math = fakeMath();
		const el = section('<p><a data-href="ammonia" class="internal-link">$NH_3$ gas</a></p>');
		const done = new ReadingView(pro, math).process(el, ctx('[[ammonia|$NH_3$ gas]]'));
		expect(el.querySelector('a')!.innerHTML).toBe('$NH_3$ gas');
		math.release();
		await done;
		expect(el.querySelector('a')!.innerHTML).toBe('<span class="math math-inline">M(NH_3)</span> gas');
	});

	it('A11 unload while MathJax loads changes nothing afterwards', async () => {
		const math = fakeMath();
		const view = new ReadingView(pro, math);
		const el = section('<p><a data-href="x" class="internal-link">$x$ and `c`</a></p>');
		const done = view.process(el, ctx('[[x|$x$ and `c`]]'));
		view.unload();
		math.release();
		await done;
		expect(el.querySelector('a')!.innerHTML).toBe('$x$ and `c`');
		void view.process(el, ctx('[[x|$x$ and `c`]]'));
		expect(el.querySelector('a')!.innerHTML).toBe('$x$ and `c`');
	});
});
