import { describe, expect, it } from 'vitest';
import { applyLineEdits } from '../src/write';

describe('applyLineEdits', () => {
	const lf = '# A\n- [ ] one\n- [ ] two\n';
	const crlf = '# A\r\n- [ ] one\r\n- [ ] two\r\n';

	it('replaces a line that still reads as expected and keeps every other byte', () => {
		const r = applyLineEdits(lf, [{ line: 2, expected: '- [ ] two', next: '- [x] two' }]);
		expect(r).toEqual({ content: '# A\n- [ ] one\n- [x] two\n', applied: [2], conflicts: [] });
	});

	it('keeps CRLF line ends even when the new line lacks the carriage return', () => {
		const r = applyLineEdits(crlf, [{ line: 1, expected: '- [ ] one\r', next: '- [x] one' }]);
		expect(r.content).toBe('# A\r\n- [x] one\r\n- [ ] two\r\n');
	});

	it('does not add a carriage return to an LF file', () => {
		const r = applyLineEdits(lf, [{ line: 1, expected: '- [ ] one', next: '- [x] one\r' }]);
		expect(r.content).toBe('# A\n- [x] one\n- [ ] two\n');
	});

	it('skips a line that changed since the view read it and returns the text unchanged', () => {
		const r = applyLineEdits(lf, [{ line: 1, expected: '- [ ] one 📅 2026-10-10', next: '- [x] one 📅 2026-10-10' }]);
		expect(r).toEqual({ content: lf, applied: [], conflicts: [1] });
	});

	it('skips a line number past the end, a negative line and a new line that holds a line break', () => {
		const r = applyLineEdits(lf, [
			{ line: 9, expected: '- [ ] one', next: 'x' },
			{ line: -1, expected: '# A', next: 'x' },
			{ line: 1, expected: '- [ ] one', next: 'a\nb' },
		]);
		expect(r).toEqual({ content: lf, applied: [], conflicts: [9, -1, 1] });
	});

	it('applies the good edits of a batch and reports the conflicts', () => {
		const r = applyLineEdits(lf, [
			{ line: 1, expected: '- [ ] one', next: '- [x] one' },
			{ line: 2, expected: '- [ ] TWO', next: '- [x] TWO' },
		]);
		expect(r).toEqual({ content: '# A\n- [x] one\n- [ ] two\n', applied: [1], conflicts: [2] });
	});
});
