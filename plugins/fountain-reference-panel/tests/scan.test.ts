import { describe, expect, it } from 'vitest';
import { incoming, panelStatus, parseFountain, reportMarkdown, scanScripts } from '../src/scan';

describe('parseFountain', () => {
	it('keeps the boneyard state across lines and ends it at the close mark', () => {
		const refs = parseFountain('INT. A - DAY\n\n/* one\n[[>X]] two\nthree */ [[>Y]] four\n[[>Z]]');
		expect(refs.map((r) => [r.linkpath, r.line])).toEqual([
			['Y', 5],
			['Z', 6],
		]);
	});

	it('an unclosed boneyard hides the rest of the script', () => {
		expect(parseFountain('[[>A]]\n/* open\n[[>B]]\n[[>C]]')).toHaveLength(1);
	});

	it('cuts long nearby text to 200 characters', () => {
		const [r] = parseFountain(`[[>A]] ${'word '.repeat(80)}`);
		expect(r!.context.length).toBe(200);
		expect(r!.context.endsWith('...')).toBe(true);
	});
});

describe('scanScripts', () => {
	it('calls the resolver with the linkpath and the script path', () => {
		const calls: string[][] = [];
		scanScripts([{ path: 'F/s.fountain', text: '[[>Ada#Top|A]]' }], (l, s) => {
			calls.push([l, s]);
			return null;
		});
		expect(calls).toEqual([['Ada', 'F/s.fountain']]);
	});

	it('an empty list with no scan is not proof of no references', () => {
		expect(panelStatus(null, 'a.md', [])).toBe('Not scanned yet. Select Refresh to scan the saved .fountain files.');
	});
});

describe('reportMarkdown', () => {
	it('writes one section for each selected note and escapes table cells', () => {
		const scan = scanScripts(
			[
				{ path: 's.fountain', text: 'INT. A | B - DAY\n\n[[>Ada]] waves.' },
				{ path: 'bad.fountain', error: 'locked' },
			],
			(l) => (l === 'Ada' ? 'Ada.md' : null),
		);
		expect(incoming(scan, 'Ada.md')).toHaveLength(1);
		expect(reportMarkdown(['Ada.md', 'Ben.md'], scan, '2026-10-13 0900')).toBe(
			[
				'# Fountain reference report',
				'',
				'Scanned 2026-10-13 0900: 2 scripts, 0 unresolved targets, 1 read failure.',
				'- Could not read bad.fountain: locked',
				'',
				'## Ada.md',
				'',
				'| Script | Line | Scene | Text |',
				'| --- | --- | --- | --- |',
				'| s.fountain | 3 | INT. A \\| B - DAY | Ada waves. |',
				'',
				'## Ben.md',
				'',
				'No references.',
				'',
			].join('\n'),
		);
	});
});
