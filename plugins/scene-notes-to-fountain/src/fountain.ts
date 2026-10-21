// Pure Fountain outline logic. No Obsidian import, so vitest and the golden vectors run it directly.

/** Property names that hold the scene heading and the synopsis. */
export interface Mapping {
	slugline: string;
	synopsis: string;
}

export const DEFAULT_MAPPING: Mapping = { slugline: 'slugline', synopsis: 'synopsis' };

/** One selected note, as read from the vault. */
export interface NoteInput {
	path: string;
	/** File name without the extension. */
	title: string;
	/** Parsed frontmatter, or null when the note has none. */
	frontmatter: Record<string, unknown> | null;
	/** Note text after the frontmatter block. */
	body: string;
}

export interface Scene {
	path: string;
	heading: string;
	synopsis: string[];
	/** Where the heading and the synopsis came from. */
	headingFrom: 'property' | 'title';
	synopsisFrom: 'property' | 'paragraph' | 'none';
}

export interface NoteError {
	path: string;
	message: string;
}

export interface Plan {
	/** Fountain text, or null when a note has an error. */
	text: string | null;
	scenes: Scene[];
	errors: NoteError[];
}

/** Text that Fountain reads as a note ([[ ]]) or as boneyard (/* *\/). Such text would be hidden in the output. */
const HIDDEN_SYNTAX = ['[[', ']]', '/*', '*/'];

/** The first hidden-syntax delimiter in text, or null. */
export function hiddenSyntax(text: string): string | null {
	for (const d of HIDDEN_SYNTAX) if (text.includes(d)) return d;
	return null;
}

/** Problem with a scene heading text, or null when Fountain keeps it as written. */
export function headingProblem(text: string): string | null {
	if (/[\r\n]/.test(text)) return 'the scene heading has a line break';
	const d = hiddenSyntax(text);
	if (d) return `the scene heading contains the Fountain delimiter ${d}`;
	// A forced heading is "." and then a letter or a digit. ".." or ". " is not a heading in Fountain.
	if (!/^[\p{L}\p{N}]/u.test(text)) return 'the scene heading must start with a letter or a digit';
	// "#1A#" at the end of a heading is a scene number in Fountain, not heading text.
	if (/#[^#\s]*#\s*$/.test(text)) return 'the scene heading ends with #...#, which Fountain reads as a scene number';
	return null;
}

/** Problem with one synopsis line, or null. */
export function synopsisProblem(line: string): string | null {
	const d = hiddenSyntax(line);
	return d ? `the synopsis contains the Fountain delimiter ${d}` : null;
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const BLOCK_START = /^\s{0,3}(#{1,6}(\s|$)|[-*+]\s|\d{1,9}[.)]\s|>|\||<!--|%%|[-*_](\s*[-*_]){2,}\s*$|\$\$)/;
const SETEXT = /^\s{0,3}(=+|-+)\s*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;
// CommonMark HTML blocks: block-level tag names, <script>, <!...> and <?...> start a block anywhere.
const HTML_BLOCK = /^\s{0,3}<(?:\/?(?:address|article|aside|blockquote|body|center|details|dialog|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|head|header|hr|html|iframe|li|main|nav|ol|p|pre|script|section|style|summary|table|tbody|td|textarea|tfoot|th|thead|tr|ul)(?:[\s/>]|$)|!|\?)/i;
// Any other tag starts a block only when it is alone on the line. Inline HTML such as <b>text</b> stays in the paragraph.
const HTML_TAG_LINE = /^\s{0,3}(?:<[A-Za-z][\w-]*(?:\s[^<>]*)?\/?>|<\/[A-Za-z][\w-]*\s*>)\s*$/;

/**
 * The first plain paragraph of a note body, as one line. Skips frontmatter, headings, list items, fenced code,
 * block quotes, tables, HTML and Obsidian comments, math blocks and thematic breaks. Returns "" when there is none.
 */
export function firstPlainParagraph(body: string): string {
	const lines = body.replace(/\r\n?/g, '\n').split('\n');
	let i = 0;
	// A frontmatter block that is still in the text.
	if (lines[0] === '---') {
		const end = lines.indexOf('---', 1);
		if (end > 0) i = end + 1;
	}
	let fence: string | null = null;
	let blockEnd: string | null = null;
	let html = false;
	for (; i < lines.length; i++) {
		const line = lines[i]!;
		if (blockEnd) {
			if (line.includes(blockEnd)) blockEnd = null;
			continue;
		}
		if (html) {
			if (!line.trim()) html = false;
			continue;
		}
		const f = FENCE.exec(line);
		if (fence) {
			if (f && f[1]![0] === fence[0] && f[1]!.length >= fence.length && line.trim() === f[1]) fence = null;
			continue;
		}
		if (f) {
			fence = f[1]!;
			continue;
		}
		const trimmed = line.trimStart();
		const delimiter = trimmed.startsWith('<!--') ? ['<!--', '-->'] : trimmed.startsWith('%%') ? ['%%', '%%'] : trimmed.startsWith('$$') ? ['$$', '$$'] : null;
		if (delimiter) {
			if (!trimmed.slice(delimiter[0]!.length).includes(delimiter[1]!)) blockEnd = delimiter[1]!;
			continue;
		}
		if (HTML_BLOCK.test(line) || HTML_TAG_LINE.test(line)) {
			html = true;
			continue;
		}
		if (line.includes('|') && TABLE_SEPARATOR.test(lines[i + 1] ?? '')) {
			i++;
			while (i + 1 < lines.length && lines[i + 1]!.includes('|') && lines[i + 1]!.trim()) i++;
			continue;
		}
		if (line.trim() && SETEXT.test(lines[i + 1] ?? '')) {
			i++;
			continue;
		}
		if (!line.trim() || BLOCK_START.test(line) || /^(\t| {4})/.test(line)) continue;
		const parts: string[] = [];
		for (; i < lines.length; i++) {
			const l = lines[i]!;
			if (!l.trim() || BLOCK_START.test(l) || FENCE.test(l) || HTML_BLOCK.test(l)) break;
			parts.push(l.trim());
		}
		return parts.join(' ');
	}
	return '';
}

function typeName(v: unknown): string {
	if (Array.isArray(v)) return 'a list';
	if (v === null) return 'empty';
	return typeof v === 'object' ? 'an object' : `a ${typeof v}`;
}

/** Reads one note into a scene, or gives the reason why it cannot be a scene. */
export function noteToScene(note: NoteInput, mapping: Mapping = DEFAULT_MAPPING): Scene | NoteError {
	const fm = note.frontmatter ?? {};
	const err = (message: string): NoteError => ({ path: note.path, message });
	const rawHeading = Object.prototype.hasOwnProperty.call(fm, mapping.slugline) ? fm[mapping.slugline] : undefined;
	const rawSynopsis = Object.prototype.hasOwnProperty.call(fm, mapping.synopsis) ? fm[mapping.synopsis] : undefined;
	if (rawHeading !== undefined && rawHeading !== null && typeof rawHeading !== 'string')
		return err(`The property "${mapping.slugline}" is ${typeName(rawHeading)}. It must be text.`);
	if (rawSynopsis !== undefined && rawSynopsis !== null && typeof rawSynopsis !== 'string')
		return err(`The property "${mapping.synopsis}" is ${typeName(rawSynopsis)}. It must be text.`);

	const fromProp = typeof rawHeading === 'string' && rawHeading.trim() !== '';
	const heading = fromProp ? rawHeading.trim() : note.title;
	const hp = headingProblem(heading);
	if (hp) return err(`Unsupported text: ${hp} (${fromProp ? `property "${mapping.slugline}"` : 'file name'}).`);

	let synopsis: string[];
	let synopsisFrom: Scene['synopsisFrom'];
	if (typeof rawSynopsis === 'string' && rawSynopsis.trim() !== '') {
		synopsis = rawSynopsis
			.replace(/\r\n?/g, '\n')
			.split('\n')
			.map((l) => l.trim())
			.filter((l) => l !== '');
		synopsisFrom = 'property';
	} else {
		const p = firstPlainParagraph(note.body);
		synopsis = p ? [p] : [];
		synopsisFrom = p ? 'paragraph' : 'none';
	}
	for (const line of synopsis) {
		const sp = synopsisProblem(line);
		if (sp) return err(`Unsupported text: ${sp} (${synopsisFrom === 'property' ? `property "${mapping.synopsis}"` : 'first paragraph'}).`);
	}
	return { path: note.path, heading, synopsis, headingFrom: fromProp ? 'property' : 'title', synopsisFrom };
}

/** Fountain text for scenes in their order: a forced heading, a blank line, and one "= " line for each synopsis line. */
export function toFountain(scenes: Pick<Scene, 'heading' | 'synopsis'>[]): string {
	return scenes.map((s) => [`.${s.heading}`, ...(s.synopsis.length ? ['', ...s.synopsis.map((l) => `= ${l}`)] : [])].join('\n')).join('\n\n') + '\n';
}

/** Builds the export plan for notes in their selected order. Any error gives a plan with no text. */
export function buildPlan(notes: NoteInput[], mapping: Mapping = DEFAULT_MAPPING): Plan {
	const scenes: Scene[] = [];
	const errors: NoteError[] = [];
	if (notes.length === 0) return { text: null, scenes, errors: [{ path: '', message: 'Select one or more notes.' }] };
	for (const n of notes) {
		const r = noteToScene(n, mapping);
		if ('message' in r) errors.push(r);
		else scenes.push(r);
	}
	return { text: errors.length ? null : toFountain(scenes), scenes, errors };
}

/** Moves item i one place up (-1) or down (+1). Returns a new array; an out-of-range move returns a copy. */
export function move<T>(items: readonly T[], i: number, dir: -1 | 1): T[] {
	const out = [...items];
	const j = i + dir;
	if (i < 0 || i >= out.length || j < 0 || j >= out.length) return out;
	[out[i], out[j]] = [out[j]!, out[i]!];
	return out;
}

/** A file name without characters that Obsidian or the file system refuse. Empty input gives "Outline". */
export function cleanFileName(name: string): string {
	const s = name
		.replace(/\.fountain$/i, '')
		.replace(/[\\/:*?"<>|#^[\]\r\n]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^\.+/, '');
	return s || 'Outline';
}

/** "<folder>/<name>.fountain", or "<name> 2.fountain" and up when that path exists. */
export function freePath(folder: string, name: string, exists: (path: string) => boolean): string {
	const dir = folder && folder !== '/' ? `${folder.replace(/\/+$/, '')}/` : '';
	const base = `${dir}${cleanFileName(name)}`;
	let path = `${base}.fountain`;
	for (let n = 2; exists(path); n++) path = `${base} ${n}.fountain`;
	return path;
}

/** True when each source text is the same as when the plan was built. */
export function sourcesUnchanged(planned: Record<string, string>, now: Record<string, string>): boolean {
	const keys = Object.keys(planned);
	return keys.length === Object.keys(now).length && keys.every((k) => now[k] === planned[k]);
}

/** The message of an error from the vault, for the window or a notice. */
export function errorText(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}
