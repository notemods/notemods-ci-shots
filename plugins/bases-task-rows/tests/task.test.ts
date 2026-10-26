import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import vectors from './vectors/bases-task-rows.json';
import { DATE_FIELDS, editAndParse, editTaskLine, joinTaskLine, nextOccurrenceLine, nextRecurrenceDate, parseTaskLine, setDateInTail, splitTaskLine, type TaskEdit } from '../src/task';

describe('golden vectors (packages/spec/vectors/bases-task-rows.json)', () => {
	for (const c of vectors.cases.filter((c) => c.fn === 'editAndParse')) {
		it(c.name, () => {
			const [line, edit] = c.args as [string, TaskEdit];
			expect(editAndParse(line, edit)).toEqual(c.expected);
		});
	}
});

describe('recurrence vectors (packages/spec/vectors/bases-task-rows.json)', () => {
	const { cases } = vectors;
	for (const c of cases.filter((c) => c.fn === 'nextRecurrenceDate')) {
		it(c.name, () => {
			expect(nextRecurrenceDate(...(c.args as [string, string | undefined]))).toEqual(c.expected);
		});
	}
	for (const c of cases.filter((c) => c.fn === 'nextOccurrenceLine')) {
		it(c.name, () => {
			expect(nextOccurrenceLine(...(c.args as [string, string, 'emoji' | 'dataview']))).toEqual(c.expected);
		});
	}
});

/** Every task line of the sample vault (30 notes, 150 tasks), with its CRLF where the note has one. */
function sampleLines(): string[] {
	const out: string[] = [];
	const walk = (d: string) => {
		for (const e of readdirSync(d)) {
			const p = join(d, e);
			if (statSync(p).isDirectory()) walk(p);
			else if (p.endsWith('.md')) out.push(...readFileSync(p, 'utf8').split('\n').filter((l) => splitTaskLine(l)));
		}
	};
	walk(join(__dirname, '..', 'docs', 'sample-notes'));
	return out;
}

describe('round trip over the sample vault', () => {
	const lines = sampleLines();

	it('finds the task lines (150 tasks plus one task-looking line in a code block)', () => {
		expect(lines.length).toBe(151);
		expect(lines.filter((l) => l.endsWith('\r')).length).toBe(5);
	});

	it('split and join give back every line byte for byte', () => {
		for (const l of lines) expect(joinTaskLine(splitTaskLine(l)!)).toBe(l);
	});

	it('tick then untick (done date never) gives back the line when it was open', () => {
		for (const l of lines.filter((x) => parseTaskLine(x)!.status === ' ')) {
			const done = editTaskLine(l, { type: 'done', today: '2026-10-10', doneDate: 'never' })!;
			expect(editTaskLine(done, { type: 'open', doneDate: 'never' })).toBe(l);
		}
	});

	it('tick then untick (auto) gives back the line when it had no done date', () => {
		for (const l of lines.filter((x) => !parseTaskLine(x)!.done && !parseTaskLine(x)!.dates.done)) {
			const done = editTaskLine(l, { type: 'done', today: '2026-10-10' })!;
			expect(parseTaskLine(done)!.done).toBe(true);
			expect(editTaskLine(done, { type: 'open' })).toBe(l);
		}
	});

	it('changing the due date changes only the date characters', () => {
		for (const l of lines.filter((x) => parseTaskLine(x)!.dates.due)) {
			const before = parseTaskLine(l)!;
			const next = editTaskLine(l, { type: 'date', field: 'due', value: '2030-01-31' })!;
			expect(next.length).toBe(l.length);
			expect(next.replace('2030-01-31', before.dates.due!)).toBe(l);
			expect(parseTaskLine(next)!.dates.due).toBe('2030-01-31');
			expect(parseTaskLine(next)!.text).toBe(before.text);
		}
	});

	it('remove then add a due date keeps the task text, tags and other dates', () => {
		for (const l of lines) {
			const before = parseTaskLine(l)!;
			const removed = editTaskLine(l, { type: 'date', field: 'due', value: null })!;
			const added = editTaskLine(removed, { type: 'date', field: 'due', value: '2026-11-11' })!;
			const after = parseTaskLine(added)!;
			expect(after.text).toBe(before.text);
			expect(after.tags).toEqual(before.tags);
			expect(after.dates.due).toBe('2026-11-11');
			for (const f of DATE_FIELDS.filter((x) => x !== 'due')) expect(after.dates[f]).toBe(before.dates[f]);
			expect(added.endsWith('\r')).toBe(l.endsWith('\r'));
		}
	});
});

describe('edge cases', () => {
	it('rejects a date that is not YYYY-MM-DD', () => {
		expect(() => setDateInTail(' a', 'due', '10/12/2026', 'emoji')).toThrow();
	});

	it('reads the variation selector form of the hourglass', () => {
		expect(parseTaskLine('- [ ] a ⏳️ 2026-10-11')!.dates.scheduled).toBe('2026-10-11');
	});

	it('reads tasks in nested quotes and with tabs', () => {
		expect(parseTaskLine('>> \t+ [/] half done')!.status).toBe('/');
		expect(parseTaskLine('>> \t+ [/] half done')!.done).toBe(false);
	});

	it('an empty task body gets a due date after one space', () => {
		expect(editTaskLine('- [ ] ', { type: 'date', field: 'due', value: '2026-10-10' })).toBe('- [ ] 📅 2026-10-10 ');
	});

	it('dataview completion alias done:: is read as the done date', () => {
		expect(parseTaskLine('- [x] a [done:: 2026-10-01]')!.dates.done).toBe('2026-10-01');
	});

	it('a Dataview line keeps the Dataview style for a new date even when the setting says emoji', () => {
		expect(editTaskLine('- [ ] a [priority:: high]', { type: 'date', field: 'scheduled', value: '2026-10-11', style: 'emoji' })).toBe('- [ ] a [priority:: high] [scheduled:: 2026-10-11]');
	});

	it('an existing done date is not doubled on tick', () => {
		expect(editTaskLine('- [ ] a ✅ 2026-10-01 📅 2026-10-02', { type: 'done', today: '2026-10-10' })).toBe('- [x] a ✅ 2026-10-01 📅 2026-10-02');
	});
});

describe('nextOccurrenceLine dates', () => {
	it('moves the scheduled and start dates by the same number of days as the due date', () => {
		expect(nextOccurrenceLine('- [ ] Review 🔁 every week 🛫 2026-10-08 ⏳ 2026-10-11 📅 2026-10-12', '2026-10-12', 'emoji')).toBe(
			'- [ ] Review 🔁 every week 🛫 2026-10-15 ⏳ 2026-10-18 📅 2026-10-19',
		);
	});

	it('counts a "when done" rule from the done date', () => {
		expect(nextOccurrenceLine('- [ ] Cut hair 🔁 every 3 weeks when done 📅 2026-09-01', '2026-10-12', 'emoji')).toBe(
			'- [ ] Cut hair 🔁 every 3 weeks when done 📅 2026-11-02',
		);
	});

	it('drops a block id on a CRLF line and keeps the carriage return', () => {
		expect(nextOccurrenceLine('- [ ] Pay rent 🔁 every month 📅 2026-10-01 ^rent\r', '2026-10-10', 'emoji')).toBe('- [ ] Pay rent 🔁 every month 📅 2026-11-01\r');
	});
});
