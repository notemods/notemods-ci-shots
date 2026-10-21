import { afterEach, describe, expect, it, vi } from 'vitest';
import { column, convert, editText } from '../src/converter';

const zone = process.env.TZ;
afterEach(() => {
	vi.restoreAllMocks();
	if (zone === undefined) delete process.env.TZ;
	else process.env.TZ = zone;
});

describe('review fixes', () => {
	it('keeps spaces around a replaced or annotated value', () => {
		expect(editText('at 1000 ms'.slice(2, 8), 'X', 'replace')).toBe(' X ');
		expect(editText(' 1000 ', 'X', 'insert')).toBe(' 1000 → X ');
		expect(editText('  0\n  -1', 'a\nb', 'replace')).toBe('  a\n  b');
	});
	it('reuses one formatter for each saved zone in a full column', () => {
		const rows = Array.from({ length: 500 }, (_, i) => String(1704067200 + i)).join('\n');
		column(rows, 'seconds', 'Asia/Tokyo');
		const spy = vi.spyOn(Intl, 'DateTimeFormat');
		expect(column(rows, 'seconds', 'Asia/Tokyo').ok).toBe(true);
		expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
	});
	it('changes the device-local offset across daylight saving dates', () => {
		process.env.TZ = 'America/New_York';
		expect(convert('1704067200', 'seconds', 'local')).toEqual({ ok: true, value: '2023-12-31T19:00:00.000-05:00' });
		expect(convert('1719792000', 'seconds', 'local')).toEqual({ ok: true, value: '2024-06-30T20:00:00.000-04:00' });
	});
});
