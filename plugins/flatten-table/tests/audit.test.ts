import { describe, expect, it } from 'vitest';
import { flatten, readPath } from '../src/flatten';
import { tokenize, type Token } from '../src/inline';
import { FlattenView } from '../src/view';

function drawCell(tokens: Token[]): HTMLElement {
	const view = Object.create(FlattenView.prototype) as FlattenView;
	const td = document.createElement('td');
	const draw = view as unknown as { drawToken(td: HTMLElement, t: Token, sourcePath: string): void };
	for (const t of tokens) draw.drawToken(td, t, 'A.md');
	return td;
}

describe('audit fixes', () => {
	it('a link target with a bare percent sign does not stop the table draw', () => {
		const td = drawCell(tokenize('[plan](Q3%plan) and [ok](Q3%20plan)'));
		expect([...td.querySelectorAll('a.internal-link')].map((a) => a.getAttribute('data-href'))).toEqual(['Q3%plan', 'Q3 plan']);
	});

	it('a javascript, data or vbscript link in a property becomes plain text', () => {
		const td = drawCell(tokenize('[a](javascript:alert(1)) [b](DATA:text/html,x) [c](vbscript:x) [d](https://example.com)'));
		expect([...td.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['https://example.com']);
		expect(td.textContent).toContain('a');
	});

	it('the tokenizer keeps the full text of a long cell', () => {
		const cell = '# '.repeat(12_000);
		expect(tokenize(cell).map((t) => t.text).join('')).toBe(cell);
	});

	it('a property name that is also an Object method name reads as missing', () => {
		expect(readPath({}, 'constructor')).toBeUndefined();
		expect(readPath({ a: {} }, 'a.toString')).toBeUndefined();
		const r = flatten([{ path: 'A.md', frontmatter: { title: 'x' } }], { property: 'constructor' });
		expect(r.rows).toHaveLength(0);
		expect(r.emptyNotes).toBe(1);
	});
});

describe('README claims', () => {
	it('rows with equal values for all sort rules keep their base order', () => {
		const items = [{ k: 'b', n: 1 }, { k: 'a', n: 2 }, { k: 'b', n: 3 }, { k: 'a', n: 4 }];
		const r = flatten([{ path: 'A.md', frontmatter: { x: items } }], { property: 'x', sort: [{ column: 'k', dir: 'desc' }] });
		expect(r.rows.map((row) => row.index)).toEqual([1, 3, 2, 4]);
	});

	it('Markdown export has source links only when the Source column is on', async () => {
		const { toMarkdown } = await import('../src/flatten');
		const r = flatten([{ path: 'A.md', frontmatter: { x: ['v'] } }], { property: 'x' });
		expect(toMarkdown(r)).toContain('[[A\\|A]]');
		expect(toMarkdown(r, false)).not.toContain('[[');
	});
});
