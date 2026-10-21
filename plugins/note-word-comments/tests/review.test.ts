import { describe, expect, it } from 'vitest';
import { parseNote, summarizeNote } from '../src/parse';

const free = { author: 'Lee' };
const pro = { author: 'Lee', pro: true };

describe('review defects', () => {
	it('a bad percent escape in an image path is a problem, not a crash', () => {
		expect(() => summarizeNote('![chart](growth-50%.png)', free)).not.toThrow();
		expect(summarizeNote('![chart](growth-50%.png)', pro).body).toEqual(['[image growth-50%.png]']);
	});

	it('a heading that ends with # inside a word keeps the #', () => {
		expect(summarizeNote('# Notes on C#', free).body).toEqual(['# Notes on C#']);
		expect(summarizeNote('## Title ##', free).body).toEqual(['## Title']);
		expect(summarizeNote('### ###', free).body).toEqual(['### ']);
	});

	it('a private use character U+E000 in the note is a problem, not a crash or a lost comment', () => {
		const r = summarizeNote('Icon  here.\n\nWord %% note %%.', free);
		expect(r.problems.length).toBeGreaterThan(0);
	});

	it('an HTML entity is a problem, because Word would show the raw text', () => {
		expect(summarizeNote('Tom &amp; Jerry', free).problems).toEqual(['line 1: HTML entity']);
	});

	it('stops on each structure that the README names', () => {
		const cases: [string, string][] = [
			['    code', 'indented code block'],
			['---', 'horizontal rule'],
			['Text [^1] here', 'footnote'],
			['Some ==marked== text', 'highlight'],
			['Some ~~old~~ text', 'strikethrough'],
			['Cost $x^2$ here', 'math'],
			['A \\* star', 'backslash escape'],
			['A <span>tag</span>', 'HTML'],
			['> [!note] Callout', 'block quote or callout'],
			['1. item', 'list'],
		];
		for (const [text, msg] of cases) expect(summarizeNote(text, free).problems, text).toContain(`line 1: ${msg}`);
	});

	it('Pro: a width after | in a wiki embed sets the image width', () => {
		const b = parseNote('![[plan.png|420]]', pro).blocks[0];
		expect(b).toMatchObject({ kind: 'image', target: 'plan.png', width: 420 });
	});
});
