// Reads notes for the outline from the vault and the metadata cache. The outline itself is pure (src/outline.ts).
import { resolveSubpath, TFile, type App, type CachedMetadata } from 'obsidian';
import { calloutAt, listHeadingAt, MAX_DEPTH, type NoteData, type OutlineSource, type Target } from './outline';

/** Upper bound on notes read for one outline. */
export const MAX_NOTES = 400;

/** Note data from the note text and its metadata cache entry. */
export function noteData(path: string, text: string, cache: CachedMetadata | null): NoteData {
	const lines = text.split(/\r?\n/);
	const headings = (cache?.headings ?? []).map((h) => ({ text: h.heading, level: h.level, line: h.position.start.line }));
	const embeds = (cache?.embeds ?? []).map((e) => ({ link: e.link, line: e.position.start.line }));
	const callouts: NoteData['callouts'] = [];
	for (const s of cache?.sections ?? []) {
		if (s.type !== 'callout') continue;
		const line = s.position.start.line;
		const c = calloutAt(lines[line] ?? '');
		if (c) callouts.push({ line, ...c });
	}
	const listHeadings: NoteData['listHeadings'] = [];
	for (const li of cache?.listItems ?? []) {
		const line = li.position.start.line;
		const h = listHeadingAt(lines[line] ?? '');
		if (h) listHeadings.push({ line, ...h });
	}
	return { path, lines, headings, embeds, callouts, listHeadings };
}

function splitLink(link: string): { linkpath: string; subpath: string } {
	const i = link.indexOf('#');
	return i < 0 ? { linkpath: link, subpath: '' } : { linkpath: link.slice(0, i), subpath: link.slice(i) };
}

/** Resolves an embed link the way the app does: the file by link text, then the heading or block by resolveSubpath. */
export function resolveTarget(app: App, link: string, fromPath: string, lineCount: (path: string) => number): Target {
	const { linkpath, subpath } = splitLink(link);
	const file = linkpath === '' ? app.vault.getFileByPath(fromPath) : app.metadataCache.getFirstLinkpathDest(linkpath, fromPath);
	if (!file) return { kind: 'missing-note' };
	if (file.extension !== 'md') return { kind: 'file' };
	const total = lineCount(file.path);
	const sub = subpath.replace(/^#+/, '');
	if (!sub) return { kind: 'note', path: file.path, start: 0, end: total, sub: 'none' };
	const block = sub.startsWith('^');
	const cache = app.metadataCache.getFileCache(file);
	const r = cache ? resolveSubpath(cache, subpath) : null;
	if (!r || r.type === 'footnote') return { kind: 'missing-sub', path: file.path, sub: block ? 'block' : 'heading' };
	if (r.type === 'heading') return { kind: 'note', path: file.path, start: r.start.line, end: r.end ? r.end.line : total, sub: 'heading' };
	return { kind: 'note', path: file.path, start: r.start.line, end: r.end ? r.end.line + 1 : total, sub: 'block' };
}

/**
 * Reads the open note and, level by level, the notes it embeds, down to `maxDepth` levels.
 * Returns a synchronous OutlineSource over what it read; notes it did not read count as missing text (no rows).
 */
export async function collect(app: App, rootPath: string, maxDepth: number): Promise<OutlineSource> {
	const notes = new Map<string, NoteData>();
	const read = async (file: TFile): Promise<NoteData> => {
		const hit = notes.get(file.path);
		if (hit) return hit;
		const data = noteData(file.path, await app.vault.cachedRead(file), app.metadataCache.getFileCache(file));
		notes.set(file.path, data);
		return data;
	};
	const lineCount = (path: string): number => notes.get(path)?.lines.length ?? Number.MAX_SAFE_INTEGER;
	const src: OutlineSource = {
		note: (path) => notes.get(path) ?? null,
		resolve: (link, fromPath) => resolveTarget(app, link, fromPath, lineCount),
	};
	const root = app.vault.getFileByPath(rootPath);
	if (!root) return src;
	let frontier = [await read(root)];
	const depth = Math.max(1, Math.min(MAX_DEPTH, maxDepth));
	for (let level = 0; level < depth && frontier.length > 0; level++) {
		const next: NoteData[] = [];
		for (const n of frontier) {
			for (const e of n.embeds) {
				const { linkpath } = splitLink(e.link);
				const f = linkpath === '' ? null : app.metadataCache.getFirstLinkpathDest(linkpath, n.path);
				if (!f || f.extension !== 'md' || notes.has(f.path)) continue;
				if (notes.size >= MAX_NOTES) {
					src.truncated = true;
					return src;
				}
				next.push(await read(f));
			}
		}
		frontier = next;
	}
	return src;
}
