import { describe, expect, it } from 'vitest';
import { sameMeasure } from '../src/editor';

describe('viewport measurement reuse', () => {
	it('invalidates document numbers after a same-length newline edit above the viewport', () => {
		const old = { from: 100000, to: 100010, top: 480000, height: 24, line: 20000, hidden: 0, starts: [100000] };
		const measured = new Map([[old.from, old]]);
		expect(sameMeasure(measured, [{ ...old }])).toBe(true);
		// Replace a space with a newline above this block: offsets and drawn rows stay the same.
		expect(sameMeasure(measured, [{ ...old, line: 20001 }])).toBe(false);
	});
});
