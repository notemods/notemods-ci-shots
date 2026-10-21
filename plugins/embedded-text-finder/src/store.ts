import { parseLinktext, resolveSubpath, type App, type TFile } from 'obsidian';
import { DocumentIndex, parseDocument, searchable, type Region, type SearchStore } from './search';

/** Reject stale section ends so text from the next heading cannot enter a result. */
export function validHeadingRange(text: string, start: number, end: number, heading: string, level: number): boolean {
	const headings = [...searchable(text).matchAll(/^ {0,3}(#{1,6})[\t ]+([^\r\n]*)/gm)];
	const current = headings.find((h) => h.index === start);
	if (!current || current[1]!.length !== level || current[2]!.replace(/\s+#+\s*$/, '').trim() !== heading) return false;
	const next = headings.find((h) => h.index > start && h[1]!.length <= level);
	return end === (next?.index ?? text.length);
}

/** Check the complete ID, not a prefix of an ID changed since the cache was made. */
function validBlockRange(text: string, start: number, end: number, id: string): boolean {
	// The cache can end before a separate block-ID line. Read through the marker,
	// but do not accept a prefix cut off by the old end offset.
	const lineEnd = text.indexOf('\n', end);
	const followingId = /^\s*\^[^\r\n]*/.exec(text.slice(end))?.[0].length ?? 0;
	const limit = Math.max(lineEnd < 0 ? text.length : lineEnd, end + followingId);
	const tail = text.slice(start, limit);
	const marker = /(?:^|\s)\^([a-zA-Z0-9-]+)[\t ]*(?:\r?\n[\t ]*)*$/.exec(tail);
	if (marker?.[1] !== id) return false;
	const body = tail.slice(0, marker.index).trimEnd();
	// A plain paragraph cannot cross a blank line. Lists, quotes and fences can.
	const compound = /^ {0,3}(?:[-+*][\t ]|\d+[.)][\t ]|>|`{3,}|~{3,})/.test(body);
	return compound || !/\r?\n[\t ]*\r?\n/.test(body);
}

export function vaultStore(app: App, files: TFile[], index?: DocumentIndex, indexEnabled: () => boolean = () => true): SearchStore {
	const fileMap = new Map(files.map((file) => [file.path, file]));
	const fileAt = (path: string) => fileMap.get(path);
	return {
		paths: () => files.map((file) => file.path),
		read: async (path) => {
			const file = fileAt(path);
			if (!file) throw new Error('Missing file');
			return index && indexEnabled() ? index.read(path, `${file.stat.mtime}:${file.stat.size}`, () => app.vault.cachedRead(file)) : parseDocument(await app.vault.cachedRead(file));
		},
		resolve: (link, from) => {
			const parsed = parseLinktext(link);
			const file = parsed.path ? app.metadataCache.getFirstLinkpathDest(parsed.path, from) : fileAt(from);
			if (file) fileMap.set(file.path, file);
			return file ? { path: file.path, subpath: parsed.subpath } : null;
		},
		region: async (path, subpath, text): Promise<Region | null> => {
			const file = fileAt(path);
			if (!file) return null;
			for (let attempt = 0; attempt < 2; attempt++) {
				const cache = app.metadataCache.getFileCache(file);
				const resolved = cache ? resolveSubpath(cache, subpath) : null;
				if (resolved && (resolved.type === 'heading' || resolved.type === 'block')) {
					const start = resolved.start.offset;
					const end = resolved.end?.offset ?? text.length;
					const valid = start >= 0 && end <= text.length && start < end && (resolved.type === 'heading'
						? validHeadingRange(text, start, end, resolved.current.heading, resolved.current.level)
						: validBlockRange(text, start, end, resolved.block.id));
					if (valid) return { start, end };
				}
				if (attempt === 0) await new Promise<void>((resolve) => window.setTimeout(resolve, 120));
			}
			return null;
		},
	};
}
