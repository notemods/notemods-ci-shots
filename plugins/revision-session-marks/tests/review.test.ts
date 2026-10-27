import { describe, expect, it, vi } from 'vitest';
import { makeReview, restoreReview, tokenize, validateProse } from '../src/review';
import { loadState } from '../src/state';

describe('Review invariants', () => {
	it('tokenizes Greek, combining marks, numbers and exact whitespace', () => {
		expect(tokenize('αβ cafe\u0301  12\r\n🙂.')).toEqual(['αβ', ' ', 'cafe\u0301', '  ', '12', '\r\n', '🙂', '.']);
	});
	it('round trips 250 deterministic prose pairs', () => {
		const words = ['αβ', 'αγ', 'cafe\u0301', 'café', 'a', 'b', '12', '😀'];
		for (let i = 0; i < 250; i++) {
			const baseline = Array.from({ length: i % 9 + 1 }, (_, j) => words[(i + j) % words.length]).join(' ') + '.';
			const final = Array.from({ length: i % 7 + 1 }, (_, j) => words[(i * 3 + j) % words.length]).join(i % 2 ? '  ' : '\t') + '\n';
			const review = makeReview(baseline, final, { author: 'Sam', summary: true });
			expect(restoreReview(review.text, true)).toBe(final);
			expect(restoreReview(review.text, false)).toBe(baseline);
		}
	});
	it('accepts exactly 100 KB and rejects more UTF-8 bytes', () => {
		expect(() => validateProse('a'.repeat(102400), 'baseline')).not.toThrow();
		expect(() => validateProse('α'.repeat(51201), 'final input')).toThrow('100 KB');
	});
	it('checks the real one second deadline with a controlled clock', () => {
		const clock = vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(1001);
		try { expect(() => makeReview('We go.', 'We stay.')).toThrow('Diff work limit'); }
		finally { clock.mockRestore(); }
	});
	it('rejects math markers and Obsidian comments as Markdown structure', () => {
		expect(() => validateProse('Area is $x$ here.', 'final input')).toThrow('Unsupported final input: Markdown structure');
		expect(() => validateProse('We go %%note%% now.', 'baseline')).toThrow('Unsupported baseline: Markdown structure');
	});
	it('rejects an unsafe author label', () => {
		expect(() => makeReview('We go.', 'We stay.', { author: '{Sam}' })).toThrow('Author label');
	});
	it('tolerates malformed saved data and fails closed on missing identity state', () => {
		expect(loadState({ settings: { author: 3 }, session: { path: 'A.md', text: 'text', ctime: 1 }, named: [null, {}, 4] }).session?.invalid).toBe(true);
		expect(loadState({ session: { path: 'A.md', text: 'text', ctime: 'wrong' } }).session).toBeNull();
		expect(loadState(null).named).toEqual([]);
	});
});
