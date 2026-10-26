// Link handling for the rendered preview and the links panel (pure).
import { xrefPath, extractOutline, type Xref } from './outline';
import { dirOf, isUrl, joinPath } from './paths';

export type LinkTarget = { kind: 'anchor'; fragment: string } | { kind: 'external'; url: string } | { kind: 'file'; path: string; fragment: string | null } | { kind: 'none' };

/**
 * What a click on an href in the preview of `fromPath` should open.
 * Asciidoctor writes xrefs to other documents as "other.adoc#id" (relfilesuffix .adoc in the preview).
 */
export function classifyHref(href: string | null, fromPath: string): LinkTarget {
	const h = (href ?? '').trim();
	if (!h) return { kind: 'none' };
	if (h.startsWith('#')) return h.length > 1 ? { kind: 'anchor', fragment: safeDecode(h.slice(1)) } : { kind: 'none' };
	if (isUrl(h)) return /^(https?|mailto|obsidian):/i.test(h) ? { kind: 'external', url: h } : { kind: 'none' };
	const hash = h.indexOf('#');
	const file = safeDecode(hash < 0 ? h : h.slice(0, hash));
	const fragment = hash < 0 ? null : safeDecode(h.slice(hash + 1)) || null;
	const path = /\.html?$/i.test(file) ? xrefPath(fromPath, file) : joinPath(dirOf(fromPath), file);
	return path ? { kind: 'file', path, fragment } : { kind: 'none' };
}

function safeDecode(s: string): string {
	try {
		return decodeURIComponent(s);
	} catch {
		return s;
	}
}

export interface ResolvedXref extends Xref {
	/** Target vault path (the source itself for an in-document reference), or null when it leaves the vault. */
	path: string | null;
	/** The target file exists, and for a fragment the anchor exists in the open document (others: file only). */
	ok: boolean;
}

/** Resolves the xrefs of a document against the vault file list and its own anchors. */
export function resolveXrefs(fromPath: string, source: string, exists: (path: string) => boolean): ResolvedXref[] {
	const outline = extractOutline(source);
	const ids = new Set(outline.anchors.map((a) => a.id));
	return outline.xrefs.map((x) => {
		if (x.file === null) return { ...x, path: fromPath, ok: x.fragment !== null && ids.has(x.fragment) };
		const path = xrefPath(fromPath, x.file);
		return { ...x, path, ok: path !== null && exists(path) };
	});
}

export interface Backlink {
	from: string;
	line: number;
	kind: 'xref' | 'include';
	raw: string;
}

/** Lines in other AsciiDoc files that point to `target` by xref (document part) or include directive. */
export function findBacklinks(target: string, docs: ReadonlyArray<{ path: string; text: string }>): Backlink[] {
	const out: Backlink[] = [];
	const inc = /^include::([^\s[](?:[^[]*[^\s[])?)\[/;
	for (const doc of docs) {
		if (doc.path === target) continue;
		for (const x of extractOutline(doc.text).xrefs) {
			if (x.file !== null && xrefPath(doc.path, x.file) === target) out.push({ from: doc.path, line: x.line, kind: 'xref', raw: x.raw });
		}
		doc.text.split(/\r?\n/).forEach((line, i) => {
			const m = inc.exec(line);
			if (m && joinPath(dirOf(doc.path), m[1] ?? '') === target) out.push({ from: doc.path, line: i, kind: 'include', raw: m[1] ?? '' });
		});
	}
	return out.sort((a, b) => a.from.localeCompare(b.from) || a.line - b.line);
}
