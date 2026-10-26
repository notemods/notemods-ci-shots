export type Unit = 'seconds' | 'milliseconds';
export type Result = { ok: true; value: string } | { ok: false; error: string };
export const ISO_FORMAT = '{date}T{time}{offset}';
const LIMIT = BigInt('8640000000000000');
const p = (n: number, width = 2): string => String(n).padStart(width, '0');
const formatters = new Map<string, Intl.DateTimeFormat>();

/** One formatter for each zone. A 500-row column in six zones must not build thousands of formatters. */
function formatter(zone: string): Intl.DateTimeFormat {
	let f = formatters.get(zone);
	if (!f) {
		f = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', era: 'short', timeZoneName: 'longOffset' });
		if (formatters.size >= 32) formatters.clear();
		formatters.set(zone, f);
	}
	return f;
}

export function validFormat(format: string): boolean {
	return format.length <= 120 && !/[\r\n]/.test(format) && ['date', 'time', 'offset'].every((token) => format.split(`{${token}}`).length === 2) && !/[{}]/.test(format.replace(/\{(?:date|time|offset)\}/g, ''));
}

export function validZone(zone: string): boolean {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(0);
		return zone.length > 0;
	} catch {
		return false;
	}
}

function yearText(year: number): string {
	return year >= 0 && year <= 9999 ? p(year, 4) : `${year < 0 ? '-' : '+'}${p(Math.abs(year), 6)}`;
}

/** Check the integer before multiplication. No note data leaves the device. */
export function convert(input: string, unit: Unit, zone = 'utc', format = ISO_FORMAT): Result {
	const text = input.trim();
	if (!/^[+-]?\d+$/.test(text) || /[\r\n]/.test(input)) return { ok: false, error: 'Select one signed integer. Fractions, exponents and text are not supported.' };
	if (text.length > 32) return { ok: false, error: 'Timestamp is outside the supported date range.' };
	const integer = BigInt(text);
	const factor = unit === 'seconds' ? BigInt(1000) : BigInt(1);
	if (integer > LIMIT / factor || integer < -LIMIT / factor) return { ok: false, error: 'Timestamp is outside the supported date range.' };
	const d = new Date(Number(integer * factor));
	if (!validFormat(format)) return { ok: false, error: 'Use each of {date}, {time} and {offset} once.' };
	let date: string;
	let time: string;
	let offset: string;
	if (zone === 'utc') {
		const iso = d.toISOString();
		const parts = iso.split('T');
		date = parts[0]!;
		time = parts[1]!.slice(0, -1);
		offset = 'Z';
	} else if (zone === 'local') {
		date = `${yearText(d.getFullYear())}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
		time = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
		// Derive the offset from wall time to retain historical offsets with seconds.
		const wall = new Date(0);
		wall.setUTCFullYear(d.getFullYear(), d.getMonth(), d.getDate());
		wall.setUTCHours(d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
		const delta = (wall.getTime() - d.getTime()) / 1000;
		const abs = Math.abs(delta);
		offset = `${delta < 0 ? '-' : '+'}${p(Math.floor(abs / 3600))}:${p(Math.floor(abs % 3600 / 60))}${abs % 60 ? ':' + p(abs % 60) : ''}`;
		if (!Number.isFinite(delta)) return { ok: false, error: 'Local date is outside the supported date range.' };
	} else {
		try {
			const parts = formatter(zone).formatToParts(d);
			const get = (key: string): string => parts.find((part) => part.type === key)?.value ?? '';
			const year = get('era') === 'BC' ? 1 - Number(get('year')) : Number(get('year'));
			date = `${yearText(year)}-${get('month')}-${get('day')}`;
			time = `${get('hour')}:${get('minute')}:${get('second')}.${p(d.getUTCMilliseconds(), 3)}`;
			offset = get('timeZoneName').replace(/^GMT/, '') || '+00:00';
		} catch {
			return { ok: false, error: 'Time zone is not supported on this device.' };
		}
	}
	return { ok: true, value: format.replace('{date}', date).replace('{time}', time).replace('{offset}', offset) };
}

export function column(input: string, unit: Unit, zone = 'utc', format = ISO_FORMAT): Result {
	const lines = input.split('\n');
	if (lines.length > 500) return { ok: false, error: 'Select 500 rows or fewer.' };
	const output: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const result = convert(lines[i]!.replace(/\r$/, ''), unit, zone, format);
		if (!result.ok) return { ok: false, error: `Row ${i + 1}: ${result.error}` };
		output.push(result.value);
	}
	return { ok: true, value: output.join('\n') };
}

/** Spaces around each selected value stay in place, so an edit does not join words. */
export function editText(source: string, output: string, mode: 'insert' | 'replace'): string {
	const rows = output.split('\n');
	return source.split('\n').map((line, i) => {
		const [, lead = '', value = '', trail = ''] = /^(\s*)([\s\S]*?)(\s*)$/.exec(line) ?? [];
		return `${lead}${mode === 'replace' ? rows[i] : `${value} → ${rows[i]}`}${trail}`;
	}).join('\n');
}
