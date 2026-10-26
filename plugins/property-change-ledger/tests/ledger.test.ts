import { describe, expect, it } from 'vitest';
import { SerialWriter, HEADER, readRecords, recordBlock, csv, counts, filterRecords, keyList, movedPath, runScenario, type Change } from '../src/ledger';
const records: Change[] = [
	{ time: '2026-10-13T09:00:00.000Z', path: 'Notes/A.md', key: 'status', old: { value: 'draft' }, new: { value: 'done' } },
	{ time: '2026-10-13T09:01:00.000Z', path: 'Notes/B.md', key: 'due', old: { value: '2026-10-20' }, new: { missing: true } },
];
describe('serial append queue', () => {
	it('keeps concurrent writes in order without lost data', async () => {
		const queue = new SerialWriter(); let content = HEADER; let release!: () => void;
		const gate = new Promise<void>(resolve => { release = resolve; });
		const a = queue.enqueue(async () => { const original = content; await gate; content = original + recordBlock([records[0]!]); });
		const b = queue.enqueue(async () => { const original = content; await Promise.resolve(); content = original + recordBlock([records[1]!]); });
		expect(queue.pending).toBe(2); release(); await Promise.all([a, b]);
		expect(readRecords(content)).toEqual(records); expect(queue.pending).toBe(0);
	});
	it('retains a failed job and retries before later writes', async () => {
		const queue = new SerialWriter(); let fail = true; const output: number[] = [];
		await queue.enqueue(async () => { if (fail) throw new Error('disk full'); output.push(1); });
		expect(queue.error).toBe('disk full'); expect(queue.pending).toBe(1);
		fail = false; await queue.enqueue(async () => { output.push(2); });
		expect(output).toEqual([1, 2]); expect(queue.error).toBeNull();
	});
});
describe('ledger and export', () => {
	it('round trips private text, code fences, newlines and missing values', () => {
		const r = { ...records[0]!, old: { value: '<script>\n```json\n|,"雪' } };
		expect(readRecords(HEADER + recordBlock([r]))).toEqual([r]);
	});
	it('skips damaged blocks', () => expect(readRecords('```json\n{bad}\n```\n```json\n{"time":5}\n```')).toEqual([]));
	it('combines note substring with exact key filter', () => {
		expect(filterRecords(records, 'A', 'status')).toEqual([records[0]]);
		expect(filterRecords(records, 'A', 'Status')).toEqual([]);
	});
	it('counts status only by note', () => expect(counts([...records, records[0]!])).toEqual([['Notes/A.md', 2]]));
	it('quotes CSV, uses CRLF and protects leading formulas', () => {
		const text = csv([{ ...records[0]!, path: '=cmd,evil".md' }]);
		expect(text).toContain('"\'=cmd,evil"".md"'); expect(text).toContain('\r\n'); expect(text).toContain('"{""value"":""draft""}"');
	});
	it('deduplicates keys without changing case', () => expect(keyList('status, status\nStatus, due')).toEqual(['status', 'Status', 'due']));
});
describe('renames', () => {
	it('maps a renamed path and its children only', () => {
		expect(movedPath('Notes/A.md', 'Notes', 'Projects')).toBe('Projects/A.md');
		expect(movedPath('Notes', 'Notes', 'Projects')).toBe('Projects');
		expect(movedPath('Notes2/A.md', 'Notes', 'Projects')).toBeNull();
	});
	it('seeds a note that moves into the folder so its next edit is a change', () => {
		expect(runScenario([{ path: 'Inbox/A.md', rename: 'Notes/A.md', props: { status: 'draft' } }, { path: 'Notes/A.md', props: { status: 'done' } }]))
			.toEqual([{ time: '2026-10-13T09:00:00.000Z', path: 'Notes/A.md', key: 'status', old: { value: 'draft' }, new: { value: 'done' } }]);
	});
});
