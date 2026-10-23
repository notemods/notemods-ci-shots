import { describe, expect, it } from 'vitest';
import { LOOK_BACK, enterAction, planEnter, stringLines } from '../src/enter';

const on = { enabled: true };

/** Every line pattern of up to 5 lines made of words, empty lines and one list item. */
function docs(): string[] {
	const parts = ['Alpha', 'Beta', '', '- item'];
	const out: string[] = [];
	const walk = (prefix: string[]) => {
		if (prefix.length) out.push(prefix.join('\n'));
		if (prefix.length === 5) return;
		for (const p of parts) walk([...prefix, p]);
	};
	walk([]);
	return out;
}

describe('Enter never joins the typed text to a neighbour paragraph', () => {
	it('after Enter in a paragraph line, typed text is a paragraph of its own', () => {
		let checked = 0;
		for (const doc of docs()) {
			const lines = doc.split('\n');
			let pos = 0;
			for (const line of lines) {
				for (const col of [line.length, Math.floor(line.length / 2)]) {
					const result = enterAction(doc, pos + col, on);
					if (result === 'default') continue;
					const typed = result.doc.slice(0, result.cursor) + 'NEW' + result.doc.slice(result.cursor);
					const out = typed.split('\n');
					const at = out.findIndex((l) => l.includes('NEW'));
					const above = out[at - 1];
					const below = out[at + 1];
					// The new line starts with the typed text or with the split text, after a blank line.
					expect(above === undefined || above.trim() === '', `above in ${JSON.stringify(typed)}`).toBe(true);
					if (out[at] === 'NEW') expect(below === undefined || below.trim() === '', `below in ${JSON.stringify(typed)}`).toBe(true);
					checked++;
				}
				pos += line.length + 1;
			}
		}
		expect(checked).toBeGreaterThan(500);
	});
});

describe('bounded scan', () => {
	const long = 'Text\n'.repeat(LOOK_BACK + 10) + 'Last';
	const src = stringLines(long);
	it('keeps the default far down a long note when the syntax tree does not cover the line', () => {
		expect(planEnter(src, src.count - 1, 4, on, false)).toBe('default');
	});
	it('acts when the syntax tree covers the line', () => {
		expect(planEnter(src, src.count - 1, 4, on, true)).not.toBe('default');
	});
	it('reads only the lines near the cursor', () => {
		const read = new Set<number>();
		const spy = { ...src, text: (i: number) => { read.add(i); return src.text(i); } };
		planEnter(spy, spy.count - 1, 4, on, true);
		expect(Math.min(...read)).toBeGreaterThanOrEqual(spy.count - 1 - LOOK_BACK);
	});
});
