// Pure logic of the pane. No Obsidian imports, so the golden vectors and the unit tests run it as is.
// resolvedLinks has the shape of MetadataCache.resolvedLinks: source path -> target path -> link count.
// Obsidian puts links, embeds, links in properties, alias, heading and block links in it, each resolved to a file.

export type ResolvedLinks = Record<string, Record<string, number> | undefined>;

export type ListMode = 'one-way' | 'paired';

export interface BacklinkRow {
	/** Vault path of the note that links to the current note. */
	path: string;
	/** File name without the .md extension. Other files keep their extension. */
	name: string;
	/** Parent folder path, or '' for the vault root. */
	folder: string;
	/** Number of links from this note to the current note. */
	count: number;
}

export interface BacklinkSplit {
	/** Notes that link to the current note, and the current note does not link to them. */
	oneWay: BacklinkRow[];
	/** Notes that link to the current note, and the current note links to them too. */
	paired: BacklinkRow[];
}

/** The name and folder of a vault path. */
export function nameAndFolder(path: string): { name: string; folder: string } {
	const slash = path.lastIndexOf('/');
	const base = slash < 0 ? path : path.slice(slash + 1);
	const folder = slash < 0 ? '' : path.slice(0, slash);
	const name = base.toLowerCase().endsWith('.md') ? base.slice(0, -3) : base;
	return { name, folder };
}

/** True when path is in folder or in one of its subfolders. "Daily" does not hold "Daily notes/a.md". */
export function inFolder(path: string, folder: string): boolean {
	const f = folder.replace(/^\/+|\/+$/g, '');
	if (!f) return false;
	return path.startsWith(f + '/');
}

/** One folder for each non-empty line. Leading and trailing slashes and spaces go. Duplicates go. */
export function parseFolders(text: string): string[] {
	const out: string[] = [];
	for (const line of text.split(/\r?\n/)) {
		const f = line.trim().replace(/^\/+|\/+$/g, '').trim();
		if (f && !out.includes(f)) out.push(f);
	}
	return out;
}

function byName(a: BacklinkRow, b: BacklinkRow): number {
	const an = a.name.toLowerCase();
	const bn = b.name.toLowerCase();
	if (an !== bn) return an < bn ? -1 : 1;
	if (a.path !== b.path) return a.path < b.path ? -1 : 1;
	return 0;
}

/**
 * Splits the backlinks of current into one-way and paired rows, in one pass over the sources.
 * A self link is not a backlink. Sources in a hidden folder do not show. Unresolved links are not in resolvedLinks.
 */
export function splitBacklinks(resolved: ResolvedLinks, current: string | null, hiddenFolders: readonly string[] = []): BacklinkSplit {
	const oneWay: BacklinkRow[] = [];
	const paired: BacklinkRow[] = [];
	if (!current) return { oneWay, paired };
	const outgoing = resolved[current] ?? {};
	for (const source in resolved) {
		if (source === current) continue;
		const count = resolved[source]?.[current] ?? 0;
		if (!(count > 0)) continue;
		if (hiddenFolders.length && hiddenFolders.some((f) => inFolder(source, f))) continue;
		const row: BacklinkRow = { path: source, ...nameAndFolder(source), count };
		if ((outgoing[source] ?? 0) > 0) paired.push(row);
		else oneWay.push(row);
	}
	oneWay.sort(byName);
	paired.sort(byName);
	return { oneWay, paired };
}

/** The text to add at the end of a note for a link back: one list item on its own line. */
export function linkBackSuffix(text: string, link: string): string {
	const lead = text === '' || text.endsWith('\n') ? '' : '\n';
	return `${lead}- ${link}\n`;
}

/** The note text after a link back. */
export function appendLinkLine(text: string, link: string): string {
	return text + linkBackSuffix(text, link);
}
