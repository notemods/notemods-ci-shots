import { describe, expect, it } from 'vitest';
import { moment } from 'obsidian';
import { dailyConfig, isDailyName } from '../src/setup';
import { buildBaseText, updatePropertyFilter } from '../src/basefile';
import { dateWindow } from '../src/matcher';

describe('one time daily setup', () => {
	it('uses core daily notes configuration', () => {
		expect(dailyConfig({ template: 'Templates/Daily', format: 'DD-MM-YYYY' }, null)).toEqual({ template: 'Templates/Daily', format: 'DD-MM-YYYY' });
	});
	it('prefers enabled Periodic Notes daily configuration', () => {
		expect(dailyConfig({ template: 'Core' }, { daily: { enabled: true, template: 'Periodic', format: 'YYYY.MM.DD' } })).toEqual({ template: 'Periodic', format: 'YYYY.MM.DD' });
	});
	it('ignores disabled Periodic Notes daily configuration', () => {
		expect(dailyConfig({ template: 'Core' }, { daily: { enabled: false, template: 'Periodic' } }).template).toBe('Core');
	});
	it.each([null, {}, { format: 42, template: false }])('defaults safely for incomplete configuration %j', (saved) => {
		expect(dailyConfig(saved, null)).toEqual({ template: '', format: 'YYYY-MM-DD' });
	});
	it.each(['2026-10-21', '2024-02-29'])('recognizes daily filenames %s', (name) => expect(isDailyName(name, 'YYYY-MM-DD')).toBe(true));
	it.each(['Project', '2026-02-29', '2026-1-2'])('rejects unrelated or invalid filenames %s', (name) => expect(isDailyName(name, 'YYYY-MM-DD')).toBe(false));
	it('recognizes a configured custom date format', () => expect(isDailyName('21.10.2026', 'DD.MM.YYYY')).toBe(true));
	it('quotes custom formats in the generated YAML', () => expect(buildBaseText('YYYY: MM: DD')).toContain('dailyNoteFormat: "YYYY: MM: DD"'));
	it('updates the chosen property filter without changing user filters', () => {
		const base = buildBaseText().replace('  and:', '  and:\n    - file.inFolder("Projects")');
		const next = updatePropertyFilter(base, ['note.meeting_date', 'note.start', 'note.end']);
		expect(next).toContain('file.inFolder("Projects")');
		expect(next).toContain('note[\\"meeting_date\\"] != null');
		expect(next).toContain('note[\\"start\\"] != null');
		expect(updatePropertyFilter(next, ['note.meeting_date', 'note.start', 'note.end'])).toBe(next);
	});
	it('does not change a user base', () => expect(updatePropertyFilter('views: []', ['note.date'])).toBe('views: []'));
	it('uses locale week boundaries when requested', () => {
		const previous = moment.locale();
		moment.locale('en');
		try {
			expect(dateWindow('2026-10-21', 'YYYY-MM-DD', 'week', 'locale')).toEqual({ start: '2026-10-18', end: '2026-10-24' });
			expect(dateWindow('2026-10-21', 'YYYY-MM-DD', 'week', 'iso')).toEqual({ start: '2026-10-19', end: '2026-10-25' });
		} finally { moment.locale(previous); }
	});
});
