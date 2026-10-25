// Pure logic: GitHub heading slugs, markdown link parsing and the convert plan.
// No Obsidian import, so the golden vectors (packages/spec/vectors/gfm-heading-slugs.json) test it directly.

/** Longest text that the plugin reads for one heading or one link destination. Longer text is cut. */
export const MAX_TEXT = 2000;
/** Most links that one convert plan holds. */
export const MAX_PLAN = 5000;

const PUA_BASE = 0xe000;
const PUA_MAX = 0xf8ff;

const ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	copy: '©',
	reg: '®',
	trade: '™',
	hellip: '…',
	mdash: '—',
	ndash: '–',
};

function decodeEntities(s: string): string {
	return s.replace(/&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z]{2,8});/g, (m, body: string) => {
		if (body.startsWith('#')) {
			const hex = body[1] === 'x' || body[1] === 'X';
			const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
			return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
		}
		return ENTITIES[body] ?? m;
	});
}

/**
 * The heading text as GitHub shows it: code span content stays, link text stays, image alt goes,
 * HTML tags go, entities decode, `_x_` emphasis markers go, `snake_case` stays.
 */
export function headingPlainText(heading: string): string {
	let s = heading.slice(0, MAX_TEXT).trim();
	// A closing sequence of an ATX heading: "Title ##".
	s = s.replace(/(^|[ \t])#+[ \t]*$/, '').trim();
	const kept: string[] = [];
	const keep = (text: string): string => {
		if (PUA_BASE + kept.length > PUA_MAX) return text;
		kept.push(text);
		return String.fromCharCode(PUA_BASE + kept.length - 1);
	};
	// Remove characters of the private use area first, so that a placeholder is never confused with input.
	s = s.replace(/[-]/g, '');
	// Code spans: the content is literal.
	s = s.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_m, _ticks: string, body: string) => {
		const inner = /^ [\s\S]* $/.test(body) && body.trim() !== '' ? body.slice(1, -1) : body;
		return keep(inner);
	});
	// Backslash escapes: the character is literal.
	s = s.replace(/\\([!-/:-@[-`{-~])/g, (_m, ch: string) => keep(ch));
	// HTML comments and autolinks.
	s = s.replace(/<!--[\s\S]*?-->/g, '');
	s = s.replace(/<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/g, (_m, url: string) => keep(url));
	// Images: the alt text does not show in the heading text.
	s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
	// Links: the link text stays.
	s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
	// HTML tags.
	s = s.replace(/<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/g, '');
	s = decodeEntities(s);
	// Underscore emphasis: a run of _ that opens at a word start and closes at a word end.
	for (let i = 0; i < 3; i++) {
		const next = s.replace(/(^|[^\p{L}\p{N}_])(_{1,3})(?=[^\s_])([\s\S]*?[^\s_])\2(?![\p{L}\p{N}_])/gu, '$1$3');
		if (next === s) break;
		s = next;
	}
	return s.replace(/[-]/g, (ch) => kept[ch.charCodeAt(0) - PUA_BASE] ?? '');
}

/** GitHub slug of one heading, without the duplicate suffix. */
export function slugify(heading: string): string {
	return headingPlainText(heading)
		.toLowerCase()
		.replace(/[^\p{L}\p{M}\p{Nd}\p{Pc}\- ]/gu, '')
		.replace(/ /g, '-');
}

/** GitHub slugs of all headings of one note, in order. A duplicate gets -1, -2 (github-slugger rule). */
export function slugAll(headings: readonly string[]): string[] {
	const seen = new Map<string, number>();
	return headings.map((h) => {
		const base = slugify(h);
		let slug = base;
		while (seen.has(slug)) {
			const n = (seen.get(base) ?? 0) + 1;
			seen.set(base, n);
			slug = `${base}-${n}`;
		}
		seen.set(slug, 0);
		return slug;
	});
}

/** Index of the heading whose GitHub slug is `fragment`, or -1. */
export function findSlug(slugs: readonly string[], fragment: string): number {
	return fragment === '' ? -1 : slugs.indexOf(fragment);
}

/** Obsidian heading match: the characters that Obsidian drops from heading links do not count, nor case or extra spaces. */
export function obsidianKey(text: string): string {
	return text
		.replace(/[#|^:%[\]\\]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

/** Index of the heading that Obsidian opens for `fragment` (the first match), or -1. */
export function findObsidian(headings: readonly string[], fragment: string): number {
	const key = obsidianKey(fragment);
	if (key === '') return -1;
	return headings.findIndex((h) => obsidianKey(h) === key);
}

/** Decodes a link fragment. Bad percent text stays as it is. */
export function decodeFragment(fragment: string): string {
	try {
		return decodeURIComponent(fragment);
	} catch {
		return fragment;
	}
}

export interface MdLink {
	/** Offset of `[` in the text. */
	from: number;
	/** Offset after `)`. */
	to: number;
	/** Offset of the destination text (after `(` or `(<`). */
	destFrom: number;
	/** Offset after the destination text. */
	destTo: number;
	/** The link text between the brackets. */
	text: string;
	/** The path part of the destination, as written ('' for the current note). */
	path: string;
	/** The fragment after the first #, as written. null when the link has no #. */
	fragment: string | null;
}

/** True for a destination with a URL scheme (https:, mailto:, obsidian:). */
function isExternal(dest: string): boolean {
	return /^[A-Za-z][A-Za-z0-9+.-]{1,31}:/.test(dest);
}

/**
 * The markdown links of one line of text with an internal destination: `[t](#frag)`, `[t](note.md#frag)`, `[t](<a b.md#frag>)`.
 * Images, external URLs and links in code spans are not returned.
 */
export function parseLinks(line: string): MdLink[] {
	const out: MdLink[] = [];
	const text = line.length > MAX_TEXT * 10 ? line.slice(0, MAX_TEXT * 10) : line;
	// Mask code spans with spaces, so that offsets stay the same.
	const masked = text.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (m) => ' '.repeat(m.length));
	const re = /\[((?:\\.|[^\]\\])*)\]\((<[^<>\n]*>|[^\s()<>]*(?:\([^\s()]*\)[^\s()<>]*)*)(?:\s+(?:"[^"]*"|'[^']*'))?\)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(masked)) !== null) {
		const from = m.index;
		if (from > 0 && masked[from - 1] === '!') continue;
		const rawDest = m[2] ?? '';
		const angle = rawDest.startsWith('<');
		const dest = angle ? rawDest.slice(1, -1) : rawDest;
		if (dest === '' || isExternal(dest)) continue;
		const destFrom = from + 1 + (m[1] ?? '').length + 2 + (angle ? 1 : 0);
		const hash = dest.indexOf('#');
		out.push({
			from,
			to: from + m[0].length,
			destFrom,
			destTo: destFrom + dest.length,
			text: m[1] ?? '',
			path: hash < 0 ? dest : dest.slice(0, hash),
			fragment: hash < 0 ? null : dest.slice(hash + 1),
		});
	}
	return out;
}

/** The link of `line` that holds offset `ch` (from <= ch < to), or null. */
export function linkAt(line: string, ch: number): MdLink | null {
	return parseLinks(line).find((l) => ch >= l.from && ch < l.to) ?? null;
}

/** Decoded path of a link destination: %20 becomes a space. */
export function decodePath(path: string): string {
	return decodeFragment(path);
}

export interface PlanItem {
	/** 0-based line of the link. */
	line: number;
	/** Offsets in the whole text. */
	from: number;
	to: number;
	/** The destination as written, and its new text. */
	old: string;
	new: string;
}

/** The headings of a link path ('' = the current note), or null when the path does not resolve. */
export type HeadingLookup = (path: string) => readonly string[] | null;

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * The changes that convert Obsidian-style heading links (`#Heading%20Text`) of `text` to GitHub slugs.
 * A link that already uses a slug, a link to a missing heading and links in fenced code stay.
 */
export function planConvertWith(text: string, lookup: HeadingLookup, firstLine = 0): PlanItem[] {
	const items: PlanItem[] = [];
	const cache = new Map<string, { headings: readonly string[]; slugs: string[] } | null>();
	const get = (path: string): { headings: readonly string[]; slugs: string[] } | null => {
		if (!cache.has(path)) {
			const h = lookup(path);
			cache.set(path, h ? { headings: h, slugs: slugAll(h) } : null);
		}
		return cache.get(path) ?? null;
	};
	let fence: string | null = null;
	let offset = 0;
	const lines = text.split('\n');
	for (let i = 0; i < lines.length && items.length < MAX_PLAN; i++) {
		const line = lines[i] ?? '';
		const f = FENCE.exec(line);
		if (fence !== null) {
			if (f && f[1]?.[0] === fence[0] && (f[1]?.length ?? 0) >= fence.length && line.trim() === f[1]) fence = null;
		} else if (f) {
			fence = f[1] ?? null;
		} else if (line.includes('](') && line.includes('#')) {
			for (const link of parseLinks(line)) {
				if (link.fragment === null || link.fragment === '') continue;
				const target = get(decodePath(link.path));
				if (!target) continue;
				const frag = decodeFragment(link.fragment);
				if (findSlug(target.slugs, frag) >= 0) continue;
				const idx = findObsidian(target.headings, frag);
				if (idx < 0) continue;
				const slug = target.slugs[idx] ?? '';
				const old = line.slice(link.destFrom, link.destTo);
				const neu = `${link.path}#${slug}`;
				if (old === neu) continue;
				items.push({ line: firstLine + i, from: offset + link.destFrom, to: offset + link.destTo, old, new: neu });
			}
		}
		offset += line.length + 1;
	}
	return items;
}

/** Vector form of planConvertWith: `targets` maps each link path ('' = the current note) to its headings. */
export function planConvert(text: string, targets: Record<string, string[]>): PlanItem[] {
	return planConvertWith(text, (p) => (Object.prototype.hasOwnProperty.call(targets, p) ? (targets[p] ?? null) : null));
}

/** Applies plan items to text (for tests and the vault-wide convert). Items must not overlap. */
export function applyPlan(text: string, items: readonly PlanItem[]): string {
	let out = text;
	for (const it of [...items].sort((a, b) => b.from - a.from)) {
		if (out.slice(it.from, it.to) !== it.old) continue;
		out = out.slice(0, it.from) + it.new + out.slice(it.to);
	}
	return out;
}

/** True when an inserted text can hold a whole heading link. One typed character never can. */
export function mayHoldLink(inserted: string): boolean {
	return inserted.length >= 5 && inserted.length <= MAX_TEXT * 10 && inserted.includes('](') && inserted.includes('#');
}

/** The heading index above or at `line` in a list of heading lines, or -1. */
export function headingAtLine(headingLines: readonly number[], line: number): number {
	let best = -1;
	for (let i = 0; i < headingLines.length; i++) {
		if ((headingLines[i] ?? Infinity) <= line) best = i;
		else break;
	}
	return best;
}

/** Markdown link text for a heading: `[Heading](#slug)`. Brackets in the text get a backslash. */
export function githubLink(heading: string, slug: string, path = ''): string {
	const text = headingPlainText(heading).replace(/([[\]\\])/g, '\\$1');
	const dest = `${path.replace(/ /g, '%20')}#${slug}`;
	return `[${text}](${dest})`;
}

/** Vector form of the convert command: the text after the plan is applied. */
export function convertText(text: string, targets: Record<string, string[]>): string {
	return applyPlan(text, planConvert(text, targets));
}
