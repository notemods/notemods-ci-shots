// A small Markdown scanner that stands in for the metadata cache in unit tests and golden vectors.
// It finds what the app's cache finds for plain notes: ATX headings, ![[embeds]], callout starts, list items,
// and ^block IDs, outside front matter and fenced code. test/e2e/outline.e2e.ts checks the same notes in the app.
import { calloutAt, listHeadingAt, sectionEnd, type NoteData, type OutlineSource, type Target } from '../src/outline';

export function scan(path: string, text: string): NoteData {
	const lines = text.split(/\r?\n/);
	const note: NoteData = { path, lines, headings: [], embeds: [], callouts: [], listHeadings: [] };
	let fence: string | null = null;
	let front = lines[0] === '---';
	lines.forEach((line, i) => {
		if (front) {
			if (i > 0 && line === '---') front = false;
			return;
		}
		const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
		if (f) {
			if (fence === null) fence = f[1]!.charAt(0);
			else if (f[1]!.charAt(0) === fence) fence = null;
			return;
		}
		if (fence !== null) return;
		const h = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(line);
		if (h) note.headings.push({ text: h[2]!, level: h[1]!.length, line: i });
		for (const m of line.matchAll(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) note.embeds.push({ link: m[1]!, line: i });
		const c = calloutAt(line);
		if (c && !(lines[i - 1] ?? '').trimStart().startsWith('>')) note.callouts.push({ line: i, ...c });
		const l = listHeadingAt(line);
		if (l) note.listHeadings.push({ line: i, ...l });
	});
	return note;
}

/** An OutlineSource over a map of path to text. Links resolve by full path or by file name, as short links do. */
export function fakeSource(files: Record<string, string>): OutlineSource {
	const notes = new Map<string, NoteData>();
	for (const [p, t] of Object.entries(files)) if (p.endsWith('.md')) notes.set(p, scan(p, t));
	const find = (linkpath: string): string | null => {
		const want = linkpath.toLowerCase();
		for (const p of Object.keys(files)) {
			const lower = p.toLowerCase();
			const name = lower.split('/').pop()!;
			if (lower === want || lower === `${want}.md` || name === want || name === `${want}.md`) return p;
		}
		return null;
	};
	return {
		note: (p) => notes.get(p) ?? null,
		resolve: (link, from): Target => {
			const i = link.indexOf('#');
			const linkpath = i < 0 ? link : link.slice(0, i);
			const sub = i < 0 ? '' : link.slice(i + 1);
			const path = linkpath === '' ? from : find(linkpath);
			if (!path) return { kind: 'missing-note' };
			if (!path.endsWith('.md')) return { kind: 'file' };
			const n = notes.get(path)!;
			if (!sub) return { kind: 'note', path, start: 0, end: n.lines.length, sub: 'none' };
			if (sub.startsWith('^')) {
				const id = sub.slice(1).toLowerCase();
				const line = n.lines.findIndex((l) => l.toLowerCase().endsWith(` ^${id}`));
				return line < 0 ? { kind: 'missing-sub', path, sub: 'block' } : { kind: 'note', path, start: line, end: line + 1, sub: 'block' };
			}
			const last = sub.split('#').filter(Boolean).pop()!.toLowerCase();
			const hi = n.headings.findIndex((h) => h.text.toLowerCase() === last);
			if (hi < 0) return { kind: 'missing-sub', path, sub: 'heading' };
			return { kind: 'note', path, start: n.headings[hi]!.line, end: sectionEnd(n, hi), sub: 'heading' };
		},
	};
}
