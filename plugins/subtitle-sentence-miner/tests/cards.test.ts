import { describe, expect, it } from 'vitest';
import { exactCloze, renderCards, validateOutputPath, validateTemplate, type Card } from '../src/cards';
import { parseSubtitles } from '../src/cues';

const cue = parseSubtitles('1\n00:00:01,000 --> 00:00:03,500\nHello world.').cues[0]!;
const card: Card = { source: 'Lessons/hello.srt', cue, answer: { kind: 'cloze', start: 6, end: 11 } };

describe('card validation and source metadata', () => {
	it('keeps both times, source and cue number in a cloze card', () => {
		const output = renderCards([card]);
		for (const text of ['Hello {{c1::world}}.', 'Source path: Lessons/hello.srt', 'Cue number: 1', 'Start: 00:00:01.000', 'End: 00:00:03.500']) expect(output).toContain(text);
	});
	it.each([[0, 0], [-1, 3], [4, 3], [0, 99], [0.5, 2]])('refuses an invalid span %s %s', (start, end) => expect(() => exactCloze('hello', start, end)).toThrow());
	it.each(['{{c1::word}}', 'a::b'])('refuses reserved cloze syntax %s', (text) => expect(() => exactCloze(text, 0, text.length)).toThrow());
	it('refuses empty selections and incomplete question cards', () => {
		expect(() => renderCards([])).toThrow();
		expect(() => renderCards([{ ...card, answer: { kind: 'qa', question: 'What?', answer: ' ' } }])).toThrow();
	});
	it('escapes note embeds and HTML decoded from cue entities', () => {
		const malicious = { ...card, cue: { ...cue, text: '![[private]] <img src=x> *bold*' }, answer: { kind: 'qa' as const, question: '[x](url)', answer: '`text`' } };
		const output = renderCards([malicious]);
		expect(output).toContain('\\!\\[\\[private\\]\\] \\<img src=x\\> \\*bold\\*');
		expect(output).toContain('Question: \\[x\\](url)');
	});
	it.each(['../Card.md', '/Card.md', 'A/../../Card.md', 'A\\Card.md', 'A//Card.md', 'A/./Card.md', 'Card.txt', '.custom/Card.md', 'Cards\u0000.md'])('refuses unsafe output %s', (path) => expect(() => validateOutputPath(path, '.custom')).toThrow());
	it('accepts a Unicode path outside the custom config folder', () => expect(() => validateOutputPath('研究/カード.md', '.custom')).not.toThrow());
	it.each(['', '{{unknown}}', 'Answer: {{answer}}'])('refuses an invalid template %s', (body) => expect(() => validateTemplate(body)).toThrow());
	it('does not expand placeholder text that comes from a cue', () => {
		const textCard = { ...card, cue: { ...cue, text: '{{answer}}' }, answer: { kind: 'qa' as const, question: 'What?', answer: 'Secret' } };
		expect(renderCards([textCard], '{{sentence}}')).toContain('{{answer}}');
	});
});
