// Pure export logic: card parsing, embed rewriting, EDN text and file names. No Obsidian import, so the golden
// vectors in packages/spec/vectors/pocket-mochi-export.json run against these functions directly.

export interface Card {
	/** Front text, with the card tag removed. */
	front: string;
	/** Back text, up to the end marker. */
	back: string;
	/** 1-based line of the front in the note. */
	line: number;
	/** False when the back ran to the end of the note or to the next front, with no --- or *** line. */
	ended: boolean;
}

export interface ParseResult {
	cards: Card[];
	warnings: string[];
}

/** Image types that the export adds to the archive. Other embeds stay as text. */
export const MEDIA_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'];

export const DEFAULT_TAG = '#card';

/** "#card", "card" or " #Card " give "#card". An empty or bad tag gives "". */
export function normalizeTag(tag: string): string {
	const t = tag.trim().replace(/^#+/, '');
	if (!t || /[\s#]/.test(t)) return '';
	return `#${t}`;
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Matches the tag as a whole tag (not #cards or #card/sub), any case. */
function tagPattern(tag: string): RegExp {
	return new RegExp(`(^|\\s)${escapeRegExp(tag)}(?![\\p{L}\\p{N}_/-])`, 'giu');
}

const END_LINE = /^\s*(-{3,}|\*{3,})\s*$/;
const FENCE = /^\s*(```|~~~)/;

/** Removes blank lines at the start and the end, and trailing spaces on the last line. */
function trimBlankLines(lines: string[]): string {
	let a = 0;
	let b = lines.length;
	while (a < b && lines[a]!.trim() === '') a++;
	while (b > a && lines[b - 1]!.trim() === '') b--;
	return lines.slice(a, b).join('\n').replace(/\s+$/, '');
}

/**
 * Reads the cards of a note. A line that has the tag is a front. The lines after it, up to the next line of
 * only --- or *** (3 or more), are the back. Front search skips the YAML front matter and fenced code blocks.
 */
export function parseCards(text: string, tag: string = DEFAULT_TAG): ParseResult {
	const t = normalizeTag(tag);
	const cards: Card[] = [];
	const warnings: string[] = [];
	if (!t) {
		warnings.push('The card tag is empty');
		return { cards, warnings };
	}
	const lines = text.replace(/\r\n?/g, '\n').split('\n');
	let i = 0;
	if (lines[0]?.trim() === '---') {
		const close = lines.findIndex((l, k) => k > 0 && /^(---|\.\.\.)\s*$/.test(l));
		if (close > 0) i = close + 1;
	}
	const isFront = (line: string) => tagPattern(t).test(line);
	let inFence = false;
	while (i < lines.length) {
		const line = lines[i]!;
		if (FENCE.test(line)) inFence = !inFence;
		if (inFence || !isFront(line)) {
			i++;
			continue;
		}
		const front = line.replace(tagPattern(t), '$1').replace(/[ \t]+/g, ' ').trim();
		const body: string[] = [];
		let j = i + 1;
		let ended = false;
		let fence = false;
		while (j < lines.length) {
			const l = lines[j]!;
			if (FENCE.test(l)) fence = !fence;
			if (!fence && END_LINE.test(l)) {
				ended = true;
				break;
			}
			if (!fence && isFront(l)) break;
			body.push(l);
			j++;
		}
		cards.push({ front, back: trimBlankLines(body), line: i + 1, ended });
		if (!ended) warnings.push(`card ${cards.length} has no end marker`);
		i = ended ? j + 1 : j;
	}
	return { cards, warnings };
}

/** Text for an EDN string literal, with quotes. Escapes " and \ and control characters; keeps Unicode. */
export function ednString(s: string): string {
	let out = '"';
	for (const ch of s) {
		if (ch === '"') out += '\\"';
		else if (ch === '\\') out += '\\\\';
		else if (ch === '\n') out += '\\n';
		else if (ch === '\r') out += '\\r';
		else if (ch === '\t') out += '\\t';
		else if (ch.charCodeAt(0) < 0x20) out += `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;
		else out += ch;
	}
	return `${out}"`;
}

export interface Deck {
	id: string;
	name: string;
	parentId?: string;
	cards: string[];
}

/** The data.edn text: :version 2 and the decks, each with its cards as :content strings. */
export function toEdn(decks: Deck[]): string {
	const parts = decks.map((d) => {
		const head = [`:id ${ednString(d.id)}`, `:name ${ednString(d.name)}`];
		if (d.parentId) head.push(`:parent-id ${ednString(d.parentId)}`);
		const cards = d.cards.map((c) => `{:content ${ednString(c)}}`).join('\n          ');
		return `{${head.join(' ')}\n  :cards [${cards}]}`;
	});
	return `{:version 2\n :decks [${parts.join('\n         ')}]}\n`;
}

/** The text of one Mochi card: front, a --- line, back. */
export function cardContent(front: string, back: string): string {
	return `${front}\n---\n${back}`;
}

function extOf(p: string): string {
	const base = p.slice(p.lastIndexOf('/') + 1);
	const dot = base.lastIndexOf('.');
	return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

function baseOf(p: string): string {
	return p.slice(p.lastIndexOf('/') + 1);
}

/** A file name for the archive root: the base name, with spaces and Markdown link characters as "-". */
export function mediaName(path: string): string {
	return baseOf(path).replace(/[\s()[\]<>]+/g, '-');
}

/** "x.png" when free, else "x-1.png", "x-2.png" and so on. */
export function uniqueMediaName(name: string, taken: Set<string>): string {
	if (!taken.has(name.toLowerCase())) return name;
	const dot = name.lastIndexOf('.');
	const stem = dot > 0 ? name.slice(0, dot) : name;
	const ext = dot > 0 ? name.slice(dot) : '';
	for (let n = 1; ; n++) {
		const c = `${stem}-${n}${ext}`;
		if (!taken.has(c.toLowerCase())) return c;
	}
}

/** Gives the vault path of a link target, or null (MetadataCache.getFirstLinkpathDest in the plugin). */
export type Resolver = (linkpath: string, sourcePath: string) => string | null;

export interface MediaTable {
	/** Vault path to archive name. */
	byPath: Map<string, string>;
	/** Lower-case archive names already used. */
	taken: Set<string>;
	/** Link texts that point to no file, in first-seen order, no duplicates. */
	missing: string[];
}

export function newMediaTable(): MediaTable {
	return { byPath: new Map(), taken: new Set(), missing: [] };
}

const WIKI_EMBED = /!\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g;
const MD_EMBED = /!\[([^\]]*)\]\((<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\)/g;

function decodeLink(raw: string): string {
	let s = raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw;
	try {
		s = decodeURIComponent(s);
	} catch {
		// Keep the raw text when it is not valid percent encoding.
	}
	return s.replace(/[#^].*$/, '').trim();
}

/** "../a/b.png" from "Notes/Bio.md" gives "a/b.png". Links that do not start with ./ or ../ stay as they are. */
export function joinRelative(link: string, sourcePath: string): string {
	if (!/^\.\.?\//.test(link)) return link;
	const parts = sourcePath.split('/').slice(0, -1);
	for (const seg of link.split('/')) {
		if (seg === '..') parts.pop();
		else if (seg !== '.' && seg !== '') parts.push(seg);
	}
	return parts.join('/');
}

/**
 * Replaces each local image embed with ![](@media/name) and adds the file to the table. A link to an image that
 * the resolver cannot find stays as text and goes on the missing list. Other embeds and web URLs stay as text.
 */
export function rewriteEmbeds(text: string, sourcePath: string, resolve: Resolver, table: MediaTable): string {
	const swap = (whole: string, linkpath: string): string => {
		// Web URLs, data URIs and links that this function wrote already (@media/) stay as they are.
		if (!linkpath || /^[a-z][a-z0-9+.-]*:/i.test(linkpath) || linkpath.startsWith('@media/')) return whole;
		const dest = resolve(linkpath, sourcePath);
		if (dest === null) {
			if (MEDIA_EXTENSIONS.includes(extOf(linkpath))) {
				const name = baseOf(linkpath);
				if (!table.missing.includes(name)) table.missing.push(name);
			}
			return whole;
		}
		if (!MEDIA_EXTENSIONS.includes(extOf(dest))) return whole;
		let name = table.byPath.get(dest);
		if (name === undefined) {
			name = uniqueMediaName(mediaName(dest), table.taken);
			table.taken.add(name.toLowerCase());
			table.byPath.set(dest, name);
		}
		return `![](@media/${name})`;
	};
	return text
		.replace(WIKI_EMBED, (whole, link: string) => swap(whole, link.trim()))
		.replace(MD_EMBED, (whole, _alt: string, link: string) => swap(whole, joinRelative(decodeLink(link), sourcePath)));
}

export interface NoteInput {
	path: string;
	text: string;
	/** Deck name; the note base name when empty. */
	deck?: string;
}

export interface ExportPlan {
	edn: string;
	decks: { name: string; cards: number }[];
	/** Each deck as written to data.edn, the parent deck too. */
	deckData: Deck[];
	cardCount: number;
	/** Vault path and archive name of each image, in first-seen order. */
	media: { path: string; name: string }[];
	missing: string[];
	warnings: string[];
}

export type DeckMode = 'one-deck-per-note' | 'sub-decks';

export interface PlanOptions {
	tag?: string;
	/** sub-decks: one parent deck with this name and one sub-deck for each note. */
	mode?: DeckMode;
	parentName?: string;
}

/** The note base name without folder and .md. */
export function noteBasename(path: string): string {
	return baseOf(path).replace(/\.md$/i, '');
}

/** Builds the data.edn text and the media list for the notes. Notes with no cards give no deck. */
export function planExport(notes: NoteInput[], resolve: Resolver, opts: PlanOptions = {}): ExportPlan {
	const table = newMediaTable();
	const decks: Deck[] = [];
	const warnings: string[] = [];
	const multi = notes.length > 1;
	let parentId: string | undefined;
	if (opts.mode === 'sub-decks') {
		parentId = 'deck-1';
		decks.push({ id: parentId, name: opts.parentName || 'Mochi export', cards: [] });
	}
	for (const note of notes) {
		const { cards, warnings: w } = parseCards(note.text, opts.tag ?? DEFAULT_TAG);
		const name = note.deck?.trim() || noteBasename(note.path);
		for (const x of w) warnings.push(multi ? `${name}: ${x}` : x);
		if (cards.length === 0) continue;
		const contents = cards.map((c) => cardContent(rewriteEmbeds(c.front, note.path, resolve, table), rewriteEmbeds(c.back, note.path, resolve, table)));
		decks.push({ id: `deck-${decks.length + 1}`, name, parentId, cards: contents });
	}
	const real = decks.filter((d) => d.cards.length > 0);
	return {
		edn: toEdn(decks),
		deckData: decks,
		decks: real.map((d) => ({ name: d.name, cards: d.cards.length })),
		cardCount: real.reduce((a, d) => a + d.cards.length, 0),
		media: [...table.byPath].map(([path, name]) => ({ path, name })),
		missing: table.missing,
		warnings,
	};
}

/** "Bio.mochi" when free, else "Bio 1.mochi", "Bio 2.mochi" and so on. A leading dot is removed: Obsidian hides dot files. */
export function archivePath(folder: string, name: string, exists: (path: string) => boolean): string {
	const dir = folder.replace(/^\/+|\/+$/g, '');
	const safe = name.replace(/[\\/:*?"<>|#^[\]]+/g, '-').trim().replace(/^\.+/, '').trim() || 'Mochi export';
	const at = (n: number) => `${dir ? `${dir}/` : ''}${safe}${n ? ` ${n}` : ''}.mochi`;
	for (let n = 0; ; n++) if (!exists(at(n))) return at(n);
}

export interface Preset {
	name: string;
	tag: string;
	folder: string;
	deck: string;
}

/**
 * Reads presets from text, one for each line: name | tag | output folder | deck name. Empty parts take the
 * defaults (the settings tag, the settings folder, the note base name). Lines with no name are skipped.
 */
export function parsePresets(text: string): Preset[] {
	const out: Preset[] = [];
	for (const raw of text.split(/\r?\n/)) {
		const parts = raw.split('|').map((p) => p.trim());
		const name = parts[0] ?? '';
		if (!name || name.startsWith('//')) continue;
		out.push({ name, tag: parts[1] ?? '', folder: parts[2] ?? '', deck: parts[3] ?? '' });
	}
	return out;
}
