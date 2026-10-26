import { describe, expect, it } from 'vitest';
import { firstPlainParagraph } from '../src/fountain';

describe('fallback blocks', () => {
	it.each([
		['HTML comment', '<!--\nHidden text.\n-->\n'],
		['Obsidian comment', '%%\nHidden text.\n%%\n'],
		['math', '$$\nHidden text.\n$$\n'],
		['HTML', '<div>\nHidden text.\n</div>\n'],
		['table without outer pipes', 'Name | Place\n--- | ---\nAda | Lab\n'],
		['setext heading', 'Scene notes\n===\n'],
		['indented code', '    Hidden text.\n'],
		['quote', '> Hidden text.\n'],
		['thematic break', '* * *\n'],
	])('skips a %s block', (_name, block) => {
		expect(firstPlainParagraph(`${block}\nAda finds a key.\n`)).toBe('Ada finds a key.');
	});

	it.each(['<!-- hidden -->', '%% hidden %%', '$$ x = 1 $$'])('skips a closed block on one line %s', (block) => {
		expect(firstPlainParagraph(`${block}\nAda finds a key.\n`)).toBe('Ada finds a key.');
	});

	it('does not use the contents of an unclosed comment', () => {
		expect(firstPlainParagraph('%%\nHidden text.\n')).toBe('');
	});

	it('uses a paragraph that starts with inline HTML', () => {
		expect(firstPlainParagraph('<b>Ada</b> finds a key.\n\nLater text.\n')).toBe('<b>Ada</b> finds a key.');
		expect(firstPlainParagraph('<span class="x">\nHidden.\n\nAda finds a key.\n')).toBe('Ada finds a key.');
	});
});
