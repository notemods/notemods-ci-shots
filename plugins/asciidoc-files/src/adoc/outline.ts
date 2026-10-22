// Outline, anchors and cross references of one AsciiDoc source (pure, line based, no Asciidoctor needed).
// Auto ids follow the Asciidoctor defaults: idprefix "_", idseparator "_", lower case, duplicates get _2, _3.
import { NO_BLOCK, isLineComment, stepBlock, type BlockState } from './blocks';
import { dirOf, extOf, isUrl, joinPath } from './paths';

export interface Section {
	/** 0 = document title, 1 = "==", up to 5. */
	level: number;
	title: string;
	id: string;
	/** 0-based line in the source. */
	line: number;
}

export interface Anchor {
	id: string;
	line: number;
	kind: 'section' | 'inline' | 'block';
}

export interface Xref {
	line: number;
	/** Text as written between << >> or after xref:. */
	raw: string;
	/** Document part (a vault path relative to the source), or null for a reference inside the same document. */
	file: string | null;
	/** Fragment (anchor id), or null. */
	fragment: string | null;
	text: string;
}

export interface Outline {
	sections: Section[];
	anchors: Anchor[];
	xrefs: Xref[];
}

const TITLE = /^(={1,6}|#{1,6})[ \t]+(\S.*?)(?:[ \t]+\1)?[ \t]*$/;
const BLOCK_ID = /^\[(?:\[([\w:][\w:.-]*)(?:,[^\]]*)?\]|#([\w:][\w:-]*)[^\]]*|[^\]]*\bid=["']?([\w:][\w:.-]*)["']?[^\]]*)\]$/;
const INLINE_ANCHOR = /\[\[([\w:][\w:.-]*)(?:,[^\]]*)?\]\]|\banchor:([\w:][\w:.-]*)\[[^\]]*\]/g;
const XREF_ANGLE = /<<([^<>,\s][^<>,]*?)(?:,\s*([^<>]*?))?>>/g;
const LEVEL_OFFSET = /^:leveloffset(?:!:|:\s*([+-]?\d+)?)\s*$/;
const XREF_MACRO = /\bxref:([^\s[]+)\[([^\]]*)\]/g;

/** Plain text of a title: drops inline formatting marks, passthroughs and tags. */
export function plainTitle(title: string): string {
	return title
		.replace(/<[^>]+>/g, '')
		.replace(/\+\+?\+?([^+]*)\+?\+?\+/g, '$1')
		.replace(/(?<![\w\\])[*_`#~^]+|[*_`#~^]+(?!\w)/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Asciidoctor auto id for a section title (defaults idprefix "_", idseparator "_"). */
export function sectionId(title: string, idprefix = '_', idseparator = '_'): string {
	let id = plainTitle(title).toLowerCase();
	id = id.replace(/&(?:[a-z][a-z]+\d{0,2}|#\d\d\d{0,4}|#x[\da-f][\da-f][\da-f]{0,3});/g, '');
	id = id.replace(/[^ \p{L}\p{N}_\-.]+/gu, '');
	if (idseparator) {
		const sep = idseparator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		id = id.replace(/[ .-]+/g, idseparator).replace(new RegExp(`(?:${sep})+`, 'g'), idseparator);
		id = id.replace(new RegExp(`^${sep}|${sep}$`, 'g'), '');
	} else id = id.replace(/ +/g, '');
	return idprefix + id;
}

/** Splits an xref target into document and fragment parts, as Asciidoctor reads them. */
export function splitXrefTarget(raw: string, macro: boolean): { file: string | null; fragment: string | null } {
	const target = raw.trim();
	const hash = target.indexOf('#');
	const path = hash < 0 ? target : target.slice(0, hash);
	const fragment = hash < 0 ? null : target.slice(hash + 1) || null;
	const isDoc = hash >= 0 ? path !== '' : /\.(adoc|asciidoc|asc|ad)$/i.test(path) || (macro && path.includes('/'));
	if (!isDoc) return { file: null, fragment: hash < 0 ? target : fragment };
	return { file: path, fragment };
}

/** leveloffset after an attribute entry: "+1" and "-1" are relative, "2" is absolute, unset or empty is 0. */
function nextOffset(current: number, value: string | undefined): number {
	if (value === undefined || value === '') return 0;
	return /^[+-]/.test(value) ? current + Number(value) : Number(value);
}

function uniqueId(base: string, seen: Map<string, number>): string {
	const n = (seen.get(base) ?? 0) + 1;
	seen.set(base, n);
	return n === 1 ? base : `${base}_${n}`;
}

function scanXrefs(line: string, lineNo: number, out: Xref[]): void {
	for (const m of line.matchAll(XREF_ANGLE)) {
		const raw = m[1] ?? '';
		out.push({ line: lineNo, raw, ...splitXrefTarget(raw, false), text: (m[2] ?? '').trim() });
	}
	for (const m of line.matchAll(XREF_MACRO)) {
		const raw = m[1] ?? '';
		if (isUrl(raw)) continue;
		out.push({ line: lineNo, raw, ...splitXrefTarget(raw, true), text: (m[2] ?? '').trim() });
	}
}

function scanAnchors(line: string, lineNo: number, out: Anchor[]): void {
	for (const m of line.matchAll(INLINE_ANCHOR)) {
		const id = m[1] ?? m[2];
		if (id) out.push({ id, line: lineNo, kind: 'inline' });
	}
}

/** Sections, anchors and xrefs of a document. Content of verbatim and comment blocks is skipped. */
export function extractOutline(source: string): Outline {
	const lines = source.replace(/\r\n?/g, '\n').split('\n');
	const out: Outline = { sections: [], anchors: [], xrefs: [] };
	const seen = new Map<string, number>();
	let block: BlockState = NO_BLOCK;
	let pendingId: string | null = null;
	let offset = 0;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		const step = stepBlock(block, line);
		const inside = block.kind !== null || step.delimiter;
		block = step.state;
		if (inside || isLineComment(line)) continue;
		const lo = LEVEL_OFFSET.exec(line);
		if (lo) {
			offset = nextOffset(offset, lo[1]);
			continue;
		}
		const idm = BLOCK_ID.exec(line.trim());
		if (idm) {
			pendingId = idm[1] ?? idm[2] ?? idm[3] ?? null;
			continue;
		}
		const t = TITLE.exec(line);
		if (t && (t[1] ?? '').length <= 6) {
			const title = t[2] ?? '';
			const id = pendingId ?? uniqueId(sectionId(title), seen);
			if (pendingId) seen.set(pendingId, (seen.get(pendingId) ?? 0) + 1);
			const level = Math.max(0, Math.min(5, (t[1] ?? '=').length - 1 + offset));
			out.sections.push({ level, title: plainTitle(title), id, line: i });
			out.anchors.push({ id, line: i, kind: 'section' });
		} else if (pendingId) out.anchors.push({ id: pendingId, line: i, kind: 'block' });
		pendingId = null;
		scanAnchors(line, i, out.anchors);
		scanXrefs(line, i, out.xrefs);
	}
	return out;
}

/** Vault path an xref document part points to, from the source file. Adds ".adoc" when the part has no extension. */
export function xrefPath(fromPath: string, file: string): string | null {
	const decoded = file.replace(/%20/g, ' ');
	const ext = extOf(decoded);
	const withExt = ext === '' ? `${decoded}.adoc` : ext === 'html' ? decoded.replace(/\.html$/i, '.adoc') : decoded;
	return joinPath(dirOf(fromPath), withExt);
}
