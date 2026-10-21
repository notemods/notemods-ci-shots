import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseNote, summarize } from '../src/parse';

const note = (name: string) => readFileSync(`docs/sample-notes/${name}`, 'utf8');

// The screenshots in README.md show these sample notes. These numbers pin what the shots show.
describe('sample notes', () => {
	it('Grant proposal: 4 comments, no problems, front matter left out', () => {
		const s = summarize(parseNote(note('Grant proposal.md'), { author: 'Writer' }));
		expect(s.problems).toEqual([]);
		expect(s.comments.map((c) => c.anchor)).toEqual(['evidence', 'away', 'dollars', 'April']);
		expect(s.body[0]).toBe('# Community garden grant');
	});

	it('Field notes: export stops and names each structure', () => {
		const s = summarize(parseNote(note('Field notes.md'), { author: 'Writer' }));
		expect(s.problems).toEqual(['line 3: bold text', 'line 5: fenced code block', 'line 9: list', 'line 10: list', 'line 12: no previous word in this paragraph']);
	});

	it('Review round: labels set two authors with Pro', () => {
		const s = summarize(parseNote(note('Review round.md'), { author: 'Writer', pro: true, labels: true }));
		expect(s.comments.map((c) => c.author)).toEqual(['Lee', 'Sam Ortiz', 'Writer']);
		expect(s.problems).toEqual([]);
	});

	it('Budget table: Pro table and image, free version stops', () => {
		const pro = parseNote(note('Budget table.md'), { author: 'Writer', pro: true, labels: true });
		expect(pro.problems).toEqual([]);
		expect(pro.blocks.map((b) => b.kind)).toEqual(['heading', 'table', 'image', 'paragraph']);
		const free = summarize(parseNote(note('Budget table.md'), { author: 'Writer' }));
		expect(free.problems).toEqual(['line 3: Markdown table (Pro)', 'line 9: image (Pro)']);
	});

	it('Book: three chapters parse with no problems', () => {
		for (const f of ['Book/01 Opening.md', 'Book/02 The letter.md', 'Book/03 Arrival.md']) expect(parseNote(note(f), { author: 'Writer' }).problems).toEqual([]);
	});
});
