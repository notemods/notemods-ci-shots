import { describe, expect, it } from 'vitest';
import vectors from './vectors/word-count-property.json';
import { deriveStats, type CountMode } from '../src/count';

describe('golden vectors (packages/spec/vectors/word-count-property.json)', () => {
	for (const c of vectors.cases) {
		it(c.name, () => {
			const [markdown, mode, includeCode, wpm, cpm] = c.args as [string, CountMode, boolean, number, number];
			expect(deriveStats(markdown, mode, includeCode, wpm, cpm)).toEqual(c.expected);
		});
	}
});

describe('source counting rules', () => {
	it.each([
		{ name: 'accepts the YAML close marker', text: '---\na: 1\n...\nVisible words', words: 2 },
		{ name: 'ignores a full closed frontmatter block', text: '---\ntitle: Three hidden words\n---\nBody', words: 1 },
		{ name: 'counts an unclosed frontmatter fence as ordinary text', text: '---\nkey: value\nBody words', words: 4 },
		{ name: 'normalizes CRLF lines', text: 'one\r\ntwo', words: 2 },
		{ name: 'returns zero for spaces and newlines', text: '  \n \t\n', words: 0 },
		{ name: 'counts headings and list numbers', text: '## Heading\n- bullet 12', words: 3 },
		{ name: 'counts source comments', text: 'alpha %% hidden phrase %% omega', words: 4 },
		{ name: 'counts both names in a wikilink', text: '[[Project|Shown]]', words: 2 },
		{ name: 'counts inline code text', text: 'Use `--flag` now', words: 3 },
		{ name: 'counts CJK and Latin together', text: 'Hello 世界', words: 3 },
		{ name: 'does not count emoji as a word', text: '🙂 ready', words: 1 },
		{ name: 'counts hyphenated terms as one word', text: 'word-count ready', words: 2 },
	] as const)('$name', ({ text, words }) => {
		expect(deriveStats(text, 'source').wordCount).toBe(words);
	});
});

describe('rendered counting rules', () => {
	it.each([
		{ name: 'keeps wikilink alias text only', text: '[[Target|Visible Name]]', words: 2 },
		{ name: 'drops embedded files', text: '![[diagram.png]] visible', words: 1 },
		{ name: 'keeps HTML element text but drops its tags', text: '<span>visible</span>', words: 1 },
		{ name: 'drops HTML comments', text: 'visible <!-- hidden words -->', words: 1 },
		{ name: 'drops inline code by default', text: 'visible `hidden words`', words: 1 },
	] as const)('$name', ({ text, words }) => {
		expect(deriveStats(text, 'rendered').wordCount).toBe(words);
	});
});

describe('reading-time boundaries', () => {
	it('uses the default speed when the words-per-minute value is zero', () => {
		expect(deriveStats(Array.from({ length: 200 }, () => 'word').join(' '), 'source', false, 0).readingTimeSeconds).toBe(60);
	});

	it('uses the default speed for non-finite values', () => {
		expect(deriveStats('one two', 'source', false, Number.POSITIVE_INFINITY).readingTimeSeconds).toBe(1);
	});

	it('rounds any positive count up to at least one second and minute', () => {
		expect(deriveStats('one', 'source')).toMatchObject({ readingTimeSeconds: 1, readingTimeMinutes: 1 });
	});

	it('rounds a reading estimate up at the next minute', () => {
		expect(deriveStats(Array.from({ length: 201 }, () => 'word').join(' ')).readingTimeSeconds).toBe(61);
		expect(deriveStats(Array.from({ length: 201 }, () => 'word').join(' ')).readingTimeMinutes).toBe(2);
	});

	it('uses CJK characters per minute for CJK reading time', () => {
		expect(deriveStats('你好世界', 'source', false, 200, 60)).toMatchObject({ wordCount: 4, readingTimeSeconds: 4 });
	});

	it('keeps zero-length notes at zero minutes', () => {
		expect(deriveStats('', 'source')).toEqual({ wordCount: 0, readingTimeMinutes: 0, readingTimeSeconds: 0 });
	});
});
