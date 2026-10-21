import { describe, expect, it } from 'vitest';
import { MAX_ITEMS, buildOutline, calloutAt, listHeadingAt, outlineLines, plainInline, toMarkdownList, wordsIn, type OutlineOptions } from '../src/outline';
import { fakeSource } from './scan';

const PRO: OutlineOptions = { callouts: true, listHeadings: true, maxDepth: 5, words: true, broken: true };

describe('calloutAt', () => {
	it('reads type and title', () => {
		expect(calloutAt('> [!WARNING]+ Check *this*')).toEqual({ type: 'warning', title: 'Check this' });
	});
	it('uses the type as the title when there is none', () => {
		expect(calloutAt('> [!faq]')).toEqual({ type: 'faq', title: 'Faq' });
	});
	it('reads a nested callout', () => {
		expect(calloutAt('> > [!note] Inner')).toEqual({ type: 'note', title: 'Inner' });
	});
	it('ignores quotes and code', () => {
		expect(calloutAt('> just a quote')).toBeNull();
		expect(calloutAt('    > [!note] indented code')).toBeNull();
	});
});

describe('listHeadingAt', () => {
	it('finds a heading in a list item', () => {
		expect(listHeadingAt('  - ## Idea #')).toEqual({ level: 2, text: 'Idea' });
		expect(listHeadingAt('3) # Step')).toEqual({ level: 1, text: 'Step' });
	});
	it('ignores tags and plain items', () => {
		expect(listHeadingAt('- #tag')).toBeNull();
		expect(listHeadingAt('- plain')).toBeNull();
		expect(listHeadingAt('- ## ')).toBeNull();
	});
});

describe('plainInline', () => {
	it('removes link and emphasis syntax', () => {
		expect(plainInline('**Bold** _it_ [[A#B|alias]] [[C#D]] [x](y) ==mark== ~~del~~')).toBe('Bold it alias C > D x mark del');
	});
	it('keeps snake_case words', () => {
		expect(plainInline('my_var and 2*3*4')).toBe('my_var and 2*3*4');
	});
});

describe('wordsIn', () => {
	it('counts prose and skips embeds, links targets and code', () => {
		expect(wordsIn(['One two', '![[Embed]]', '```', 'code here', '```', '[[Target|three]]'], 0, 6)).toBe(3);
	});
	it('counts nothing for an empty range', () => {
		expect(wordsIn(['a b c'], 1, 1)).toBe(0);
	});
});

describe('buildOutline', () => {
	it('clamps the depth to 1..5', () => {
		const files = { 'A.md': '![[B]]\n', 'B.md': '![[C]]\n', 'C.md': '# C\n' };
		expect(buildOutline('A.md', fakeSource(files), { ...PRO, maxDepth: 0 }).locked).toBe(1);
		expect(buildOutline('A.md', fakeSource(files), { ...PRO, maxDepth: 99 }).locked).toBe(0);
	});
	it('lists every note it read', () => {
		const files = { 'A.md': '![[B]]\n![[img.png]]\n', 'B.md': '# B\n', 'img.png': '' };
		expect(buildOutline('A.md', fakeSource(files), PRO).paths.sort()).toEqual(['A.md', 'B.md']);
	});
	it('stops at MAX_ITEMS rows', () => {
		const text = Array.from({ length: MAX_ITEMS + 10 }, (_, i) => `## H${i}`).join('\n');
		const o = buildOutline('Big.md', fakeSource({ 'Big.md': text }), PRO);
		expect(o.truncated).toBe(true);
		expect(outlineLines(o.items).length).toBe(MAX_ITEMS);
	});
	it('ends a loop of three notes', () => {
		const files = { 'A.md': '# A\n![[B]]\n', 'B.md': '# B\n![[C]]\n', 'C.md': '# C\n![[A]]\n' };
		const o = buildOutline('A.md', fakeSource(files), { ...PRO, words: false });
		expect(o.broken).toBe(1);
		expect(outlineLines(o.items).at(-1)).toBe('          @ A @1');
	});
});

describe('toMarkdownList', () => {
	const files = {
		'Draft.md': '# Draft: v2\n## Part one\n![[Chapter 1]]\n> [!todo] Fix the end\n![[Gone]]\n',
		'Chapter 1.md': '# Chapter 1\nSome words here.\n',
	};
	it('links each heading and keeps embeds, callouts and broken embeds', () => {
		const o = buildOutline('Draft.md', fakeSource(files), PRO);
		const md = toMarkdownList(o, { linkText: (p) => p.replace(/\.md$/, ''), words: true });
		expect(md).toBe(
			[
				'- [[Draft#Draft v2|Draft: v2]] (12 words)',
				'\t- [[Draft#Part one|Part one]] (10 words)',
				'\t\t- [[Chapter 1]] (5 words)',
				'\t\t\t- [[Chapter 1#Chapter 1|Chapter 1]] (5 words)',
				'\t\t- todo: Fix the end',
				'\t\t- Missing note: `Gone`',
				'',
			].join('\n'),
		);
	});
	it('leaves counts out when words is off', () => {
		const o = buildOutline('Chapter 1.md', fakeSource(files), PRO);
		expect(toMarkdownList(o, { linkText: (p) => p, words: false })).toBe('- [[Chapter 1.md#Chapter 1|Chapter 1]]\n');
	});
	it('gives an empty string for no rows', () => {
		const o = buildOutline('E.md', fakeSource({ 'E.md': '' }), PRO);
		expect(toMarkdownList(o, { linkText: (p) => p, words: true })).toBe('');
	});
});
