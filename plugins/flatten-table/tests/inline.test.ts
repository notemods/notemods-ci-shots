import { describe, expect, it } from 'vitest';
import { tokenize } from '../src/inline';

describe('tokenize', () => {
	it('plain text is one token', () => {
		expect(tokenize('just text, 3 * 4')).toEqual([{ kind: 'text', text: 'just text, 3 * 4' }]);
	});
	it('wikilinks with alias, heading and embed', () => {
		expect(tokenize('[[People/Ana|Ana]] and [[Plan#Goals]] ![[img.png]]')).toEqual([
			{ kind: 'wikilink', target: 'People/Ana', text: 'Ana' },
			{ kind: 'text', text: ' and ' },
			{ kind: 'wikilink', target: 'Plan#Goals', text: 'Plan > Goals' },
			{ kind: 'text', text: ' ' },
			{ kind: 'wikilink', target: 'img.png', text: 'img.png' },
		]);
	});
	it('markdown links, code and emphasis', () => {
		expect(tokenize('[site](https://example.com) `a|b` **bold** *it* ~~old~~ ==hi==')).toEqual([
			{ kind: 'link', href: 'https://example.com', text: 'site' },
			{ kind: 'text', text: ' ' },
			{ kind: 'code', text: 'a|b' },
			{ kind: 'text', text: ' ' },
			{ kind: 'strong', text: 'bold' },
			{ kind: 'text', text: ' ' },
			{ kind: 'em', text: 'it' },
			{ kind: 'text', text: ' ' },
			{ kind: 'del', text: 'old' },
			{ kind: 'text', text: ' ' },
			{ kind: 'mark', text: 'hi' },
		]);
	});
	it('tags only at a word start, not in the middle of a word', () => {
		expect(tokenize('#urgent a#b #2026')).toEqual([
			{ kind: 'tag', text: '#urgent' },
			{ kind: 'text', text: ' a#b #2026' },
		]);
	});
	it('snake_case words are not italic', () => {
		expect(tokenize('my_var_name')).toEqual([{ kind: 'text', text: 'my_var_name' }]);
	});
	it('unclosed markers stay text', () => {
		expect(tokenize('**open and `tick')).toEqual([{ kind: 'text', text: '**open and `tick' }]);
	});
});
