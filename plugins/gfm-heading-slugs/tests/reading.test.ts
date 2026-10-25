import { describe, expect, it } from 'vitest';
import { ReadingView, ORIGINAL_HREF, SLUG_ATTR } from '../src/reading';
import { slugAll } from '../src/slug';
import type { MarkdownPostProcessorContext } from 'obsidian';
import type { SlugIndex } from '../src/resolve';

const headings = ['Intro', 'Setup Steps', 'Intro'].map((heading, i) => ({ heading, level: 2, position: { start: { line: i * 2, col: 0, offset: 0 }, end: { line: i * 2, col: 0, offset: 0 } } }));
const note = { headings, slugs: slugAll(headings.map((h) => h.heading)) };
const file = { path: 'Doc.md' };
const index = {
	fileOf: () => file,
	slugsOf: () => note,
	resolve: (dest: string) => {
		const frag = dest.slice(dest.indexOf('#') + 1);
		const i = note.slugs.indexOf(frag);
		return i < 0 ? null : { file, index: i, heading: headings[i], slug: frag };
	},
	obsidianLinktext: (t: { heading: { heading: string } }) => `Doc#${t.heading.heading}`,
} as unknown as SlugIndex;

function ctx(lineStart: number | null): MarkdownPostProcessorContext {
	return { sourcePath: 'Doc.md', getSectionInfo: () => (lineStart === null ? null : { text: '', lineStart, lineEnd: lineStart }) } as unknown as MarkdownPostProcessorContext;
}

describe('Reading view (rule 5)', () => {
	it('6 gives a heading its slug id by its line, a later duplicate gets -1', () => {
		const view = new ReadingView(index, () => true);
		const el = document.createElement('div');
		el.innerHTML = '<h2 data-heading="Intro">Intro</h2>';
		view.process(el, ctx(4));
		const h = el.querySelector('h2')!;
		expect(h.id).toBe('intro-1');
		expect(h.getAttribute(SLUG_ATTR)).toBe('intro-1');
	});

	it('6 a link with a slug target gets the Obsidian target and keeps the original', () => {
		const view = new ReadingView(index, () => true);
		const el = document.createElement('div');
		el.innerHTML = '<p><a class="internal-link" data-href="#setup-steps" href="#setup-steps">go</a> <a class="internal-link" data-href="#Setup Steps">old</a></p>';
		view.process(el, ctx(null));
		const [a, b] = Array.from(el.querySelectorAll('a'));
		expect(a!.getAttribute('data-href')).toBe('Doc#Setup Steps');
		expect(a!.getAttribute(ORIGINAL_HREF)).toBe('#setup-steps');
		expect(b!.getAttribute('data-href')).toBe('#Setup Steps');
		expect(b!.hasAttribute(ORIGINAL_HREF)).toBe(false);
	});

	it('1 the setting off changes nothing', () => {
		const view = new ReadingView(index, () => false);
		const el = document.createElement('div');
		el.innerHTML = '<h2 data-heading="Intro">Intro</h2>';
		view.process(el, ctx(0));
		expect(el.querySelector('h2')!.id).toBe('');
	});
});
