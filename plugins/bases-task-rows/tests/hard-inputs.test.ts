import { describe, expect, it } from 'vitest';
import { editTaskLine, nextRecurrenceDate, parseTaskLine, setDateInTail } from '../src/task';
import { collectTasks } from '../src/rows';

describe('hard date inputs', () => {
	it('reads date links in Tasks and Dataview fields', () => {
		for (const token of ['📅 [[2026-10-18]]', '[due:: [[2026-10-18]]]', '(due:: [[2026-10-18]])']) {
			const line = `- [ ] Review ${token} #日本語\r`;
			expect(parseTaskLine(line)?.dates.due).toBe('2026-10-18');
			expect(parseTaskLine(line)?.text).toBe('Review');
			expect(editTaskLine(line, { type: 'date', field: 'due', value: '2026-10-19' })).toBe(line.replace('2026-10-18', '2026-10-19'));
		}
	});

	it('ignores impossible dates and incomplete date tokens', () => {
		for (const value of ['2026-02-30', '2025-02-29', '2026-00-10', '2026-13-01', '2026-10-181', '2026-10-18abc']) {
			expect(parseTaskLine(`- [ ] Review 📅 ${value}`)?.dates).toEqual({});
		}
		expect(parseTaskLine('- [ ] Review 📅 2028-02-29')?.dates.due).toBe('2028-02-29');
		expect(() => setDateInTail(' Review', 'due', '2026-02-30', 'emoji')).toThrow();
		expect(nextRecurrenceDate('every day', '2026-02-30')).toBeNull();
		expect(nextRecurrenceDate('every year', '2026-02-29')).toBeNull();
	});

	it('keeps literal metadata in code and edits only the real date', () => {
		const line = '- [ ] Explain ``📅 2026-10-01 `example` #literal`` then 📅 2026-10-18 #real';
		expect(parseTaskLine(line)?.dates.due).toBe('2026-10-18');
		expect(parseTaskLine(line)?.text).toBe('Explain ``📅 2026-10-01 `example` #literal`` then');
		expect(parseTaskLine(line)?.tags).toEqual(['real']);
		expect(editTaskLine(line, { type: 'date', field: 'due', value: '2026-10-19' })).toBe(line.replace('then 📅 2026-10-18', 'then 📅 2026-10-19'));
	});

	it('collects 1000 CRLF tasks and keeps unrecognised dates as text', () => {
		const content = Array.from({ length: 1000 }, (_, i) => `- [ ] Task ${i} 📅 18/10/2026`).join('\r\n');
		const rows = collectTasks('Tasks.md', 'Tasks', content, Array.from({ length: 1000 }, (_, line) => ({ line, task: ' ' })), []);
		expect(rows).toHaveLength(1000);
		expect(rows[0]?.raw.endsWith('\r')).toBe(true);
		expect(rows[999]?.info.text).toBe('Task 999 📅 18/10/2026');
		expect(rows[999]?.info.dates).toEqual({});
	});
});
