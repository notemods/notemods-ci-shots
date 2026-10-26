export interface Cue {
	number: number;
	identifier: string;
	start: number;
	end: number;
	text: string;
}

export interface ParseResult {
	cues: Cue[];
	warnings: string[];
}

/** Convert a subtitle time to seconds. Refuse out-of-range minutes and seconds. */
export function parseTime(value: string): number | null {
	const m = /^(?:(\d{2,}):)?(\d{2}):(\d{2})[.,](\d{3})$/.exec(value);
	if (!m || Number(m[2]) > 59 || Number(m[3]) > 59) return null;
	return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

/** Plain text only. No HTML is inserted into the app. Decode entities after tags are removed. */
export function subtitleText(value: string): string {
	const names: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
	return value
		.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
		.replace(/<br\s*\/?\s*>/gi, '\n')
		.replace(/<[^>]*>/g, '')
		.replace(/\{\\[^}]*\}/g, '')
		.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole: string, key: string) => {
			if (!key.startsWith('#')) return names[key.toLowerCase()] ?? whole;
			const n = key[1]?.toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
			return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : whole;
		})
		.split('\n').map((line) => line.trim()).join('\n').trim();
}

/** Parse local SRT and VTT blocks. Keep the input string unchanged. */
export function parseSubtitles(input: string): ParseResult {
	const result: ParseResult = { cues: [], warnings: [] };
	const blocks = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n(?:[\t ]*\n)+/);
	let number = 0;
	for (const block of blocks) {
		const lines = block.split('\n');
		const first = (lines[0] ?? '').trim();
		if (!first) continue;
		if (/^WEBVTT(?:\s|$)/.test(first)) continue;
		if (/^(NOTE|STYLE|REGION)(?:\s|$)/.test(first)) {
			result.warnings.push(`Skipped ${first.split(/\s/)[0]} block.`);
			continue;
		}
		number++;
		const timeIndex = first.includes('-->') ? 0 : 1;
		const time = (lines[timeIndex] ?? '').trim();
		const m = /^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/.exec(time);
		const start = m ? parseTime(m[1]!) : null;
		const end = m ? parseTime(m[2]!) : null;
		const text = subtitleText(lines.slice(timeIndex + 1).join('\n'));
		if (start === null || end === null || end <= start || !text || text.includes('-->')) {
			result.warnings.push(`Skipped malformed cue ${number}.`);
			continue;
		}
		const identifier = timeIndex === 1 ? first : '';
		result.cues.push({ number: /^\d+$/.test(identifier) ? Number(identifier) : number, identifier, start, end, text });
	}
	return result;
}

export function filterCues(cues: Cue[], query: string): Cue[] {
	const needle = query.toLocaleLowerCase();
	return cues.filter((cue) => cue.text.toLocaleLowerCase().includes(needle));
}

export function formatTime(seconds: number): string {
	const ms = Math.round(seconds * 1000);
	const pad = (n: number, width = 2) => String(n).padStart(width, '0');
	return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
}
