// Pure RIS logic: property values in, checked records and RIS text out. No Obsidian API here, so the
// golden vectors in packages/spec/vectors/note-ris-export.json run against these functions directly.

/** The fields that a field map can map to a property key. */
export const FIELDS = ['type', 'title', 'authors', 'year', 'journal', 'doi', 'url', 'abstract'] as const;
export type Field = (typeof FIELDS)[number];
export type FieldMap = Record<Field, string>;

/** The RIS types that this plugin writes. */
export const TYPES = ['JOUR', 'BOOK', 'CONF'] as const;

export const DEFAULT_MAP: FieldMap = {
	type: 'type',
	title: 'title',
	authors: 'authors',
	year: 'year',
	journal: 'journal',
	doi: 'doi',
	url: 'url',
	abstract: 'abstract',
};

/** RIS tag for each field. */
export const TAGS: Record<Field, string> = {
	type: 'TY',
	title: 'TI',
	authors: 'AU',
	year: 'PY',
	journal: 'T2',
	doi: 'DO',
	url: 'UR',
	abstract: 'AB',
};

export interface Source {
	path: string;
	/** The frontmatter of the note, or null when the note has no properties. */
	props: Record<string, unknown> | null;
}

export interface Reference {
	path: string;
	type: string;
	title: string;
	authors: string[];
	year: string;
	journal: string;
	doi: string;
	url: string;
	abstract: string;
}

export interface Problem {
	path: string;
	errors: string[];
}

export type ExportResult = { ok: true; count: number; text: string } | { ok: false; problems: Problem[] };

/** Fills empty or bad keys of a saved map with the default keys. */
export function normalizeMap(saved: unknown): FieldMap {
	const s = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>;
	const out = { ...DEFAULT_MAP };
	for (const f of FIELDS) {
		const v = s[f];
		if (typeof v === 'string' && v.trim()) out[f] = v.trim();
	}
	return out;
}

/** Each line break (CRLF, CR or LF) becomes one space. Then the ends are trimmed. */
export function oneLine(text: string): string {
	return text.replace(/\r\n|\r|\n/g, ' ').trim();
}

/** [[Lee]] gives Lee and [[Lee|J. Lee]] gives J. Lee. Other text stays as it is. */
export function unlink(text: string): string {
	const m = /^\[\[([^\]|]*)(?:\|([^\]]*))?\]\]$/.exec(text.trim());
	if (!m) return text;
	return (m[2] ?? m[1] ?? '').trim();
}

function present(v: unknown): boolean {
	return v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');
}

/** A string, or a finite number as text. Else null. */
function scalar(v: unknown): string | null {
	if (typeof v === 'string') return oneLine(v);
	if (typeof v === 'number' && Number.isFinite(v)) return String(v);
	return null;
}

/** Reads one note with the field map. Gives a reference, or the list of errors for that note. */
export function readReference(src: Source, map: FieldMap): { ref: Reference | null; errors: string[] } {
	const p = src.props ?? {};
	const errors: string[] = [];
	const get = (f: Field): unknown => p[map[f]];

	let type = '';
	const rawType = get('type');
	if (!present(rawType)) errors.push(`missing type (property "${map.type}")`);
	else if (typeof rawType !== 'string' || !(TYPES as readonly string[]).includes(rawType.trim())) errors.push(`unsupported type ${JSON.stringify(rawType)}; use JOUR, BOOK or CONF`);
	else type = rawType.trim();

	let title = '';
	const rawTitle = get('title');
	if (!present(rawTitle)) errors.push(`missing title (property "${map.title}")`);
	else {
		const t = scalar(rawTitle);
		if (t === null || t === '') errors.push(`title is not text (property "${map.title}")`);
		else title = t;
	}

	const authors: string[] = [];
	const rawAuthors = get('authors');
	if (present(rawAuthors)) {
		if (!Array.isArray(rawAuthors)) errors.push(`unsupported authors ${JSON.stringify(rawAuthors)}; write a list (property "${map.authors}")`);
		else {
			for (const a of rawAuthors) {
				const name = typeof a === 'string' ? oneLine(unlink(a)) : '';
				if (!name) {
					errors.push(`an author is empty or not text (property "${map.authors}")`);
					break;
				}
				authors.push(name);
			}
		}
	}

	let year = '';
	const rawYear = get('year');
	if (present(rawYear)) {
		const y = scalar(rawYear);
		if (y === null || !/^\d{4}$/.test(y)) errors.push(`year ${JSON.stringify(rawYear)} is not a 4-digit year (property "${map.year}")`);
		else year = y;
	}

	const text = (f: Field, check?: (v: string) => boolean, what?: string): string => {
		const raw = get(f);
		if (!present(raw)) return '';
		const v = scalar(raw);
		if (v === null) {
			errors.push(`${f} is not text (property "${map[f]}")`);
			return '';
		}
		if (check && !check(v)) {
			errors.push(`${f} ${JSON.stringify(v)} ${what ?? 'is not valid'} (property "${map[f]}")`);
			return '';
		}
		return v;
	};
	const journal = text('journal');
	const doi = text('doi', (v) => /^10\.[^\s/]+\/\S+$/.test(v), 'is not a DOI that starts with 10.');
	const url = text('url', (v) => /^https?:\/\/\S+$/.test(v), 'is not an http or https URL');
	const abstract = text('abstract');

	if (errors.length) return { ref: null, errors };
	return { ref: { path: src.path, type, title, authors, year, journal, doi, url, abstract }, errors };
}

/** One RIS line: the tag, two spaces, a hyphen, a space and the value. */
export function risLine(tag: string, value: string): string {
	return `${tag}  - ${value}`;
}

/** The RIS record of one reference, from TY to ER. Lines end with CRLF. */
export function recordText(ref: Reference): string {
	const lines = [risLine('TY', ref.type), risLine('TI', ref.title)];
	for (const a of ref.authors) lines.push(risLine('AU', a));
	if (ref.year) lines.push(risLine('PY', ref.year));
	if (ref.journal) lines.push(risLine('T2', ref.journal));
	if (ref.doi) lines.push(risLine('DO', ref.doi));
	if (ref.url) lines.push(risLine('UR', ref.url));
	if (ref.abstract) lines.push(risLine('AB', ref.abstract));
	lines.push(risLine('ER', ''));
	return lines.map((l) => l + '\r\n').join('');
}

/** Code unit order of the paths, the same on each device. */
export function byPath(a: { path: string }, b: { path: string }): number {
	return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/** Checks each note. Gives the problems, sorted by path. Empty means the export can start. */
export function checkSources(sources: Source[], map: FieldMap): Problem[] {
	const out: Problem[] = [];
	for (const s of [...sources].sort(byPath)) {
		const { errors } = readReference(s, map);
		if (errors.length) out.push({ path: s.path, errors });
	}
	return out;
}

/** The full RIS text, or the problems. One problem stops the export: no partial text. */
export function buildRis(sources: Source[], map: FieldMap): ExportResult {
	if (sources.length === 0) return { ok: false, problems: [{ path: '', errors: ['no reference notes'] }] };
	const problems: Problem[] = [];
	const refs: Reference[] = [];
	for (const s of [...sources].sort(byPath)) {
		const r = readReference(s, map);
		if (r.ref) refs.push(r.ref);
		else problems.push({ path: s.path, errors: r.errors });
	}
	if (problems.length) return { ok: false, problems };
	return { ok: true, count: refs.length, text: refs.map(recordText).join('\r\n') };
}

/** True when the path is in the folder or one of its subfolders. "" or "/" is the vault root. */
export function inFolder(path: string, folder: string): boolean {
	const f = folder.replace(/^\/+|\/+$/g, '');
	return f === '' || path.startsWith(f + '/');
}

/** "References.ris", then "References (2).ris", "References (3).ris" and so on. */
export function freePath(base: string, exists: (path: string) => boolean): string {
	const stem = base.replace(/\.ris$/i, '');
	let path = `${stem}.ris`;
	for (let n = 2; exists(path); n++) path = `${stem} (${n}).ris`;
	return path;
}

export interface Filter {
	key: string;
	value: string;
}

/** "collection = thesis" gives { key: "collection", value: "thesis" }. Text without "=" gives null. */
export function parseFilter(text: string): Filter | null {
	const i = text.indexOf('=');
	if (i < 0) return null;
	const key = text.slice(0, i).trim();
	const value = text.slice(i + 1).trim();
	return key && value ? { key, value } : null;
}

/** True when the property equals the value, or is a list that holds the value. Case matters. */
export function matchesFilter(props: Record<string, unknown> | null, filter: Filter): boolean {
	const v = props?.[filter.key];
	const eq = (x: unknown) => (typeof x === 'string' ? unlink(x).trim() : typeof x === 'number' || typeof x === 'boolean' ? String(x) : null) === filter.value;
	return Array.isArray(v) ? v.some(eq) : eq(v);
}

/** freePath with a list of the paths that exist. */
export function freePathIn(base: string, taken: string[]): string {
	return freePath(base, (p) => taken.includes(p));
}
